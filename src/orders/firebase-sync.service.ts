import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { OrderStatus, PaymentState } from '@prisma/client';
import { SignatureUtil } from '../wallet/signature.util';

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

    this.logger.log('Started listening to ALL Firebase orders for bidirectional sync...');

    // Listen for new or updated orders in Firebase
    firestore.collection('orders').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        
        if (change.type === 'added' || (change.type === 'modified' && !data.syncedToPostgres)) {
          // New order or order that hasn't been synced yet
          if (data.status === 'pending' && !data.syncedToPostgres) {
            await this.syncOrder(change.doc);
          }
        } else if (change.type === 'modified' && data.syncedToPostgres && data.postgresOrderId) {
          // Order already exists in Postgres, sync updates from Firebase (Driver/Customer actions)
          await this.syncStatusFromFirebase(change.doc);
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

  // Sync updates FROM Firebase TO Postgres (Driver App / Customer App actions)
  private async syncStatusFromFirebase(doc: any) {
    const data = doc.data();
    const postgresOrderId = data.postgresOrderId;
    const firebaseStatus = data.status;

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: postgresOrderId },
        include: { restaurant: true }
      });

      if (!order) return;

      const targetStatus = this.mapFirebaseToPostgresStatus(firebaseStatus);
      
      // 1. Sync Status if changed in Firebase
      if (targetStatus && order.status !== targetStatus) {
        this.logger.log(`🔄 Syncing status change FROM Firebase: ${firebaseStatus} -> ${targetStatus} for Order ${postgresOrderId}`);
        
        const updatedOrder = await this.prisma.order.update({
          where: { id: postgresOrderId },
          data: { 
            status: targetStatus,
            // Update timestamps if they exist in Firestore
            ...(targetStatus === OrderStatus.OUT_FOR_DELIVERY ? { pickedUpAt: new Date() } : {}),
            ...(targetStatus === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
          },
          include: { restaurant: true, items: true }
        });

        // Broadcast to Vendor dashboard
        this.gateway.emitToVendor(order.restaurantId, 'order:status_changed', updatedOrder);

        // If delivered, handle earnings
        if (targetStatus === OrderStatus.DELIVERED && order.status !== OrderStatus.DELIVERED) {
          await this.handleOrderDeliveredInternal(updatedOrder);
        }
      }

      // 2. Sync Driver Assignment if changed in Firebase
      if (data.driverId && (!order.driverId || data.driverId !== order.driverId)) {
         // Find driver by firebaseUid
         const driver = await this.prisma.driverProfile.findFirst({
           where: { user: { firebaseUid: data.driverId } },
         });

         if (driver && driver.id !== order.driverId) {
           this.logger.log(`🚗 Syncing driver assignment FROM Firebase: Driver ${driver.id} for Order ${postgresOrderId}`);
           await this.prisma.order.update({
             where: { id: postgresOrderId },
             data: { driverId: driver.id }
           });
           this.gateway.emitToVendor(order.restaurantId, 'order:driver_assigned', { orderId: postgresOrderId, driverId: driver.id });
         }
      }

    } catch (error) {
      this.logger.error(`Error syncing status from Firebase for doc ${doc.id}:`, error);
    }
  }

  private mapFirebaseToPostgresStatus(firebaseStatus: string): OrderStatus | null {
    switch(firebaseStatus) {
      case 'pending': return OrderStatus.PENDING;
      case 'accepted': return OrderStatus.CONFIRMED;
      case 'preparing': return OrderStatus.PREPARING;
      case 'ready': return OrderStatus.READY;
      case 'on_the_way': return OrderStatus.OUT_FOR_DELIVERY;
      case 'delivered': return OrderStatus.DELIVERED;
      case 'cancelled': return OrderStatus.CANCELLED;
      default: return null;
    }
  }

  // Simplified version of OrdersService.handleDelivered to avoid circular dependency
  private async handleOrderDeliveredInternal(order: any) {
    this.logger.log(`💰 Processing earnings for delivered order ${order.id}`);
    
    try {
      const restaurantShare = order.subtotal;
      const driverShare = order.deliveryFee + (order.driverBoost || 0) + (order.tips || 0);
      const appShare = order.serviceFee;
      const isCash = order.paymentMethod === 'CASH';
      const cashCollected = isCash ? order.total : 0;

      // Update Order financials
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          appCommission: 0,
          restaurantShare,
          driverShare,
          appShare,
          cashCollected,
        }
      });

      // Update Restaurant Earnings
      if (order.restaurantId) {
        await this.prisma.restaurant.update({
          where: { id: order.restaurantId },
          data: {
            pendingBalance: { increment: restaurantShare },
            totalEarnings: { increment: restaurantShare },
          },
        });

        // Ledger for restaurant owner
        if (order.restaurant.ownerId) {
          await this.prisma.ledger.create({
            data: {
              userId: order.restaurant.ownerId,
              orderId: order.id,
              type: 'EARNING',
              amount: restaurantShare,
              status: 'pending',
              signature: SignatureUtil.signLedgerEntry({
                userId: order.restaurant.ownerId,
                orderId: order.id,
                type: 'EARNING',
                amount: restaurantShare,
              }),
            },
          });
        }
      }

      // Update Driver Earnings & Debt
      if (order.driverId) {
        const driver = await this.prisma.driverProfile.findUnique({ where: { id: order.driverId } });
        if (driver) {
          const debtIncrease = isCash ? (cashCollected - driverShare) : 0;
          await this.prisma.driverProfile.update({
            where: { id: order.driverId },
            data: {
              totalEarnings: { increment: driverShare },
              debtBalance: { increment: debtIncrease },
              totalTrips: { increment: 1 },
            },
          });

          // Ledger for driver
          await this.prisma.ledger.create({
            data: {
              userId: driver.userId,
              orderId: order.id,
              type: 'EARNING',
              amount: driverShare,
              status: 'completed',
              signature: SignatureUtil.signLedgerEntry({
                userId: driver.userId,
                orderId: order.id,
                type: 'EARNING',
                amount: driverShare,
              }),
            },
          });
        }
      }
    } catch (err) {
      this.logger.error(`Failed to process earnings for order ${order.id}:`, err);
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
