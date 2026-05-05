import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { OrderStatus, PaymentState } from '@prisma/client';

@Injectable()
export class FirebaseSyncService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseSyncService.name);

  // Temporary mappings to bridge Firebase to PostgreSQL for the vendor dashboard test
  private readonly DEFAULT_RESTAURANT_ID = '794c1583-0c99-47d5-96b4-705d12901cf5'; // Test Restaurant
  private readonly DEFAULT_CUSTOMER_ID = '4b146d23-8089-4162-b611-0b7f50c32c98'; // Z-SPEED Customer
  private readonly DEFAULT_FOOD_ITEM_ID = '9e847040-c7d6-46e7-a546-2eb6120782de'; // Test Burger

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit() {
    this.startListening();
  }

  private startListening() {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) {
      this.logger.warn('Firestore not available. Order sync will not run.');
      return;
    }

    this.logger.log('Started listening to Firebase orders collection...');

    // Listen for new or updated orders in Firebase
    // Note: We cannot use where('syncedToPostgres', '!=', true) because Firestore excludes docs where the field doesn't exist
    firestore.collection('orders')
      .where('status', '==', 'pending')
      .onSnapshot(async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === 'added' || change.type === 'modified') {
            const data = change.doc.data();
            if (data.syncedToPostgres !== true) {
              await this.syncOrder(change.doc);
            }
          }
        }
      }, (error) => {
        this.logger.error('Error listening to Firebase orders:', error);
      });
  }

  private async syncOrder(doc: any) {
    try {
      const data = doc.data();
      this.logger.log(`Syncing Firebase order: ${doc.id}`);

      // 1. Resolve Customer
      let customerId = this.DEFAULT_CUSTOMER_ID;
      if (data.customerId) {
        let user = await this.prisma.user.findFirst({
          where: { firebaseUid: data.customerId }
        });
        // Fallback to supabaseId just in case
        if (!user) {
          user = await this.prisma.user.findFirst({
            where: { supabaseId: data.customerId }
          });
        }
        
        // If user still not found, try to fetch from Firebase Auth and create in Postgres
        if (!user) {
          try {
            const authUser = await this.firebaseAdmin.getAuth().getUser(data.customerId);
            if (authUser) {
              user = await this.prisma.user.create({
                data: {
                  firebaseUid: authUser.uid,
                  email: authUser.email || `${authUser.uid}@temp.zspeed.com`,
                  name: authUser.displayName || data.customerName || 'Z-SPEED App User',
                  phone: authUser.phoneNumber || null,
                  role: 'CUSTOMER',
                }
              });
              this.logger.log(`Created missing user in Postgres: ${user.id} from Firebase Auth`);
            }
          } catch (err) {
            this.logger.warn(`Could not fetch user from Firebase Auth: ${err.message}`);
          }
        }

        if (user) customerId = user.id;
      }

      // 2. Resolve Restaurant
      let restaurantId = this.DEFAULT_RESTAURANT_ID;
      if (data.restaurantId) {
        const restaurant = await this.prisma.restaurant.findFirst({
          where: { firebaseId: data.restaurantId }
        });
        if (restaurant) restaurantId = restaurant.id;
      }

      // 3. Resolve Items
      const itemsToCreate = [];
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          let foodItemId = this.DEFAULT_FOOD_ITEM_ID;
          if (item.menuItemId || item.id) {
            const fbId = item.menuItemId || item.id;
            const dbItem = await this.prisma.foodItem.findFirst({
              where: { firebaseId: fbId }
            });
            if (dbItem) foodItemId = dbItem.id;
          }

          itemsToCreate.push({
            foodItem: { connect: { id: foodItemId } }, 
            quantity: item.quantity || 1,
            unitPrice: item.price || 0,
            specialNote: item.name || 'Synced Item',
          });
        }
      }

      // 4. Create Order in PostgreSQL
      const order = await this.prisma.order.create({
        data: {
          customerId,
          restaurantId,
          firebaseOrderId: doc.id,
          status: OrderStatus.PENDING,
          subtotal: data.subtotal || data.total || 0,
          deliveryFee: data.deliveryFee || 0,
          serviceFee: data.serviceFee || 0,
          discount: data.discount || 0,
          total: data.total || 0,
          paymentMethod: (data.paymentMethod || 'CASH').toUpperCase(),
          paymentState: data.paymentState === 'paid' ? PaymentState.PAID : PaymentState.PENDING,
          deliveryAddress: data.deliveryAddress || 'Synced Address',
          deliveryLat: data.deliveryLat || 30.0444,
          deliveryLng: data.deliveryLng || 31.2357,
          customerNote: `Synced from Firebase (${doc.id})\n${data.customerNote || ''}`,
          items: {
            create: itemsToCreate
          }
        },
        include: {
          items: { include: { foodItem: true } },
          customer: true,
        }
      });

      this.logger.log(`✅ Successfully synced Firebase order ${doc.id} -> Postgres Order ${order.id}`);

      // 5. Broadcast to Dashboard
      this.gateway.emitToVendor(restaurantId, 'order:new', order);

      // 6. Mark as synced in Firebase
      await doc.ref.update({
        syncedToPostgres: true,
        postgresOrderId: order.id,
      });

    } catch (error) {
      this.logger.error(`Failed to sync Firebase order ${doc.id}:`, error.stack);
    }
  }

  // Bidirectional sync: Update Firebase when Postgres order status changes
  async updateFirebaseOrderStatus(postgresOrderId: string, newStatus: OrderStatus) {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      // Find the order in Postgres to get the firebaseOrderId
      const order = await this.prisma.order.findUnique({
        where: { id: postgresOrderId },
        select: { firebaseOrderId: true }
      });

      if (!order || !order.firebaseOrderId) {
        this.logger.warn(`Cannot sync status to Firebase: Postgres Order ${postgresOrderId} has no firebaseOrderId`);
        return;
      }

      // Map Postgres status to Firebase status
      let firebaseStatus = 'pending';
      switch(newStatus) {
        case OrderStatus.CONFIRMED: firebaseStatus = 'accepted'; break;
        case OrderStatus.PREPARING: firebaseStatus = 'preparing'; break;
        case OrderStatus.READY: firebaseStatus = 'ready'; break;
        case OrderStatus.OUT_FOR_DELIVERY: firebaseStatus = 'on_the_way'; break;
        case OrderStatus.DELIVERED: firebaseStatus = 'delivered'; break;
        case OrderStatus.CANCELLED: firebaseStatus = 'cancelled'; break;
      }

      // Update directly using the document ID
      await firestore.collection('orders').doc(order.firebaseOrderId).update({ 
        status: firebaseStatus, 
        updatedAt: new Date() 
      });
      
      this.logger.log(`Synced status ${newStatus} (${firebaseStatus}) back to Firebase order ${order.firebaseOrderId}`);
    } catch (error) {
      this.logger.error(`Failed to sync status to Firebase for Postgres Order ${postgresOrderId}:`, error);
      throw new Error(`Failed to sync status with Firebase: ${error.message}`);
    }
  }
}
