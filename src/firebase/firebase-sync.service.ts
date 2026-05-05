import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseAdminService } from './firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { OrderStatus, PaymentState } from '@prisma/client';

@Injectable()
export class FirebaseSyncService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseSyncService.name);

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit() {
    this.startListening();
  }

  private startListening() {
    const db = this.firebaseAdmin.getFirestore();
    
    this.logger.log('📡 Starting real-time listener for Firebase orders...');

    db.collection('orders').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        const firebaseOrderId = change.doc.id;

        if (change.type === 'added' || change.type === 'modified') {
          await this.syncOrder(firebaseOrderId, data);
        }
      }
    }, (error) => {
      this.logger.error('❌ Firestore listener error:', error);
    });
  }

  private async syncOrder(firebaseOrderId: string, data: any) {
    try {
      // 1. Find or Sync User (Customer)
      let user = await this.prisma.user.findUnique({
        where: { firebaseUid: data.customerId }
      });

      if (!user) {
        this.logger.log(`👤 Syncing user from Firebase: ${data.customerId}`);
        const userDoc = await this.firebaseAdmin.getFirestore().collection('users').doc(data.customerId).get();
        const userData = userDoc.data();
        const email = userData?.email || `${data.customerId}@firebase.sync`;

        // Check if user exists by email
        user = await this.prisma.user.findUnique({ where: { email } });

        if (user) {
          // Link existing user to firebaseUid
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { firebaseUid: data.customerId }
          });
        } else {
          // Create new user
          user = await this.prisma.user.create({
            data: {
              firebaseUid: data.customerId,
              email,
              name: userData?.name || 'Firebase Customer',
              role: 'CUSTOMER',
              status: 'ACTIVE',
            }
          });
        }
      }

      // 2. Find Restaurant
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { firebaseId: data.restaurantId }
      });

      if (!restaurant) {
        this.logger.warn(`🏪 Restaurant not found in SQL for Firebase ID: ${data.restaurantId}. Skipping order ${firebaseOrderId}`);
        return;
      }

      // 3. Map Status
      const statusMap: Record<string, OrderStatus> = {
        'pending': OrderStatus.PENDING,
        'confirmed': OrderStatus.CONFIRMED,
        'preparing': OrderStatus.PREPARING,
        'ready': OrderStatus.READY,
        'delivered': OrderStatus.DELIVERED,
        'cancelled': OrderStatus.CANCELLED,
      };
      const status = statusMap[data.status.toLowerCase()] || OrderStatus.PENDING;

      // 4. Upsert Order
      const existingOrder = await this.prisma.order.findUnique({
        where: { firebaseOrderId }
      });

      if (existingOrder) {
        // Update status if changed
        if (existingOrder.status !== status) {
          await this.prisma.order.update({
            where: { id: existingOrder.id },
            data: { status }
          });
          this.logger.log(`🔄 Updated order ${firebaseOrderId} status to ${status}`);
          this.gateway.server.emit('order:status_changed', { orderId: existingOrder.id, status });
        }
      } else {
        // Create new order
        const orderItems = [];
        for (const item of (data.items || [])) {
          let foodItem = await this.prisma.foodItem.findUnique({
            where: { firebaseId: item.menuItemId }
          });

          if (!foodItem) {
            this.logger.log(`🍔 Creating missing food item: ${item.name}`);
            // Find or create a 'Legacy Sync' section for this restaurant
            let section = await this.prisma.menuSection.findFirst({
              where: { restaurantId: restaurant.id, name: 'Legacy Sync' }
            });

            if (!section) {
              section = await this.prisma.menuSection.create({
                data: {
                  restaurantId: restaurant.id,
                  name: 'Legacy Sync',
                  isActive: true,
                }
              });
            }

            foodItem = await this.prisma.foodItem.create({
              data: {
                firebaseId: item.menuItemId,
                sectionId: section.id,
                name: item.name,
                price: item.price,
                isAvailable: true,
              }
            });
          }

          orderItems.push({
            foodItemId: foodItem.id,
            quantity: item.quantity,
            unitPrice: item.price,
          });
        }

        const newOrder = await this.prisma.order.create({
          data: {
            firebaseOrderId,
            customerId: user.id,
            restaurantId: restaurant.id,
            status,
            subtotal: data.subtotal || 0,
            deliveryFee: data.deliveryFee || 0,
            serviceFee: data.serviceFee || 0,
            total: data.total || 0,
            paymentMethod: data.paymentMethod?.toUpperCase() || 'CASH',
            paymentState: data.paymentState === 'paid' ? PaymentState.PAID : PaymentState.PENDING,
            deliveryAddress: data.deliveryAddress || 'No Address',
            deliveryLat: data.deliveryLat || 0,
            deliveryLng: data.deliveryLng || 0,
            items: {
              create: orderItems
            }
          }
        });

        this.logger.log(`📥 Injected new Firebase order: ${firebaseOrderId} -> SQL: ${newOrder.id}`);
        this.gateway.server.emit('order:new', newOrder);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to sync order ${firebaseOrderId}:`, error);
    }
  }

  /**
   * Sync status back to Firebase
   */
  async syncStatusToFirebase(firebaseOrderId: string, status: string) {
    try {
      const db = this.firebaseAdmin.getFirestore();
      await db.collection('orders').doc(firebaseOrderId).update({
        status: status.toLowerCase(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      this.logger.log(`📤 Pushed status update for ${firebaseOrderId} to Firebase: ${status}`);
    } catch (error) {
      this.logger.error(`❌ Failed to push status to Firebase for ${firebaseOrderId}:`, error);
    }
  }
}
