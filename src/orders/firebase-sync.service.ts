import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus, PaymentState, DeliveryRequestStatus } from '@prisma/client';
import { SignatureUtil } from '../wallet/signature.util';
import { Cron } from '@nestjs/schedule';

import { OrdersService } from './orders.service';
import { NotificationsService } from '../notifications/notifications.service';

const safeParseFloat = (val: any, fallback: number | null = null): number | null => {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = parseFloat(val.toString());
  return isNaN(parsed) ? fallback : parsed;
};

const safeParseInt = (val: any, fallback: number | null = null): number | null => {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = parseInt(val.toString(), 10);
  return isNaN(parsed) ? fallback : parsed;
};

@Injectable()
export class FirebaseSyncService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseSyncService.name);

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly gateway: RealtimeGateway,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    private readonly stateMachine: OrderStateMachineService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    this.startListening();
    // Run ALL initial syncs sequentially in background on startup to prevent pool exhaustion
    try {
      await this.initialSyncAddresses();
      await this.initialSyncRestaurants();
      await this.initialSyncDrivers();
      await this.initialSyncMenu();
    } catch (err) {
      this.logger.error('Initial sync failed:', err);
    }
  }

  private startListening() {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) {
      this.logger.warn('Firestore not available. Order sync will not run.');
      return;
    }

    this.logger.log('Started listening to ALL Firebase orders and restaurants for bidirectional sync...');

    // 1. Listen for new or updated orders in Firebase
    firestore.collection('orders').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();

        if (change.type === 'added') {
          // isNew=true only for orders not yet synced to Postgres (genuine new orders)
          const isNew = !data.syncedToPostgres;
          await this.syncOrder(change.doc, !isNew, isNew);
        } else if (change.type === 'modified') {
          if (!data.syncedToPostgres) {
            await this.syncOrder(change.doc, false, false);
          } else if (data.postgresOrderId) {
            await this.syncStatusFromFirebase(change.doc);
          }
        }
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase orders:', error);
    });

    // 2. Listen for restaurant changes in Firebase
    firestore.collection('restaurants').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        await this.syncRestaurant(change.doc);
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase restaurants:', error);
    });

    // 3. Listen for menu sections (Collection Group)
    firestore.collectionGroup('menuSections').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        await this.syncMenuSection(change.doc);
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase menu sections:', error);
    });

    // 4. Listen for food items (Collection Group)
    firestore.collectionGroup('items').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        await this.syncFoodItem(change.doc);
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase food items:', error);
    });

    // 5. Listen for driver profiles and live locations
    firestore.collection('driverProfiles').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        await this.syncDriver(change.doc);
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase driver profiles:', error);
    });

    // 6. Listen for delivery request responses (Driver accepts/rejects)
    firestore.collection('deliveryRequests').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        if (change.type === 'modified' && data.status === 'accepted') {
          await this.handleDriverAcceptance(data);
        }
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase delivery requests:', error);
    });

    // 7. Listen for User Addresses (Collection Group)
    firestore.collectionGroup('addresses').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        await this.syncUserAddress(change.doc);
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase user addresses:', error);
    });

    // 8. Listen for Users collection changes to synchronize fcmTokens to Postgres
    firestore.collection('users').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const uid = change.doc.id;
        const data = change.doc.data();
        if (data.fcmTokens && Array.isArray(data.fcmTokens)) {
          // Find user in PostgreSQL and update fcmTokens
          const user = await this.prisma.user.findFirst({
            where: { firebaseUid: uid }
          });
          if (user) {
            await this.prisma.user.update({
              where: { id: user.id },
              data: { fcmTokens: data.fcmTokens },
            }).catch(err => this.logger.error(`Failed to sync fcmTokens for user ${uid}: ${err.message}`));
          }
        }
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase users:', error);
    });

    // 9. Listen for Chats collection changes to send push notifications
    const lastChatMsgTimeMap = new Map<string, number>();
    firestore.collection('chats').onSnapshot(async (snapshot) => {
      const now = Date.now();
      for (const change of snapshot.docChanges()) {
        const chatId = change.doc.id;
        const data = change.doc.data();
        if (!data || !data.lastMessageAt) continue;

        const msgTime = typeof data.lastMessageAt.toMillis === 'function'
          ? data.lastMessageAt.toMillis()
          : new Date(data.lastMessageAt).getTime();

        // Avoid triggering historical messages on startup
        if (now - msgTime > 120000) {
          const currentSaved = lastChatMsgTimeMap.get(chatId) || 0;
          if (msgTime > currentSaved) {
            lastChatMsgTimeMap.set(chatId, msgTime);
          }
          continue;
        }

        const lastProcessed = lastChatMsgTimeMap.get(chatId) || 0;
        if (msgTime <= lastProcessed) {
          continue;
        }

        lastChatMsgTimeMap.set(chatId, msgTime);

        if (change.type === 'added' || change.type === 'modified') {
          const { customerId, restaurantId, lastMessage, lastMessageSenderId, restaurantName, customerName } = data;
          if (!lastMessageSenderId || !lastMessage) continue;

          if (lastMessageSenderId === customerId) {
            // Customer sent the message -> Recipient is the Pharmacy Owner (Vendor)
            try {
              const restaurant = await this.prisma.restaurant.findFirst({
                where: { firebaseId: restaurantId },
                select: { ownerId: true, name: true }
              });

              if (restaurant && restaurant.ownerId) {
                this.logger.log(`Sending Chat Push Notification to Vendor (Owner of restaurant ${restaurantId})`);
                await this.notificationsService.createNotification(
                  restaurant.ownerId,
                  `رسالة جديدة من ${customerName || 'العميل'}`,
                  lastMessage,
                  'chat',
                  {
                    screen: 'pharmacy_chat',
                    chatId: chatId,
                    requestId: '',
                    pharmacyName: restaurant.name || restaurantName || 'الصيدلية',
                    type: 'chat'
                  }
                );
              }
            } catch (err) {
              this.logger.error(`Error sending chat notification to vendor: ${err.message}`);
            }
          } else {
            // Pharmacy sent the message -> Recipient is the Customer
            try {
              const customer = await this.prisma.user.findFirst({
                where: { firebaseUid: customerId },
                select: { id: true }
              });

              if (customer) {
                this.logger.log(`Sending Chat Push Notification to Customer ${customerId}`);
                await this.notificationsService.createNotification(
                  customer.id,
                  `رسالة جديدة من ${restaurantName || 'الصيدلية'}`,
                  lastMessage,
                  'chat',
                  {
                    screen: 'pharmacy_chat',
                    chatId: chatId,
                    requestId: '',
                    pharmacyName: restaurantName || 'الصيدلية',
                    type: 'chat'
                  }
                );
              }
            } catch (err) {
              this.logger.error(`Error sending chat notification to customer: ${err.message}`);
            }
          }
        }
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase chats:', error);
    });

    // 10. Listen for Prescription Requests collection changes to send push notifications
    const lastPrescriptionStatusMap = new Map<string, string>();
    const lastPrescriptionTimeMap = new Map<string, number>();
    firestore.collection('prescription_requests').onSnapshot(async (snapshot) => {
      const now = Date.now();
      for (const change of snapshot.docChanges()) {
        const reqId = change.doc.id;
        const data = change.doc.data();
        if (!data) continue;

        const updatedAtTime = data.updatedAt
          ? (typeof data.updatedAt.toMillis === 'function' ? data.updatedAt.toMillis() : new Date(data.updatedAt).getTime())
          : (data.createdAt ? (typeof data.createdAt.toMillis === 'function' ? data.createdAt.toMillis() : new Date(data.createdAt).getTime()) : now);

        const prevStatus = lastPrescriptionStatusMap.get(reqId);
        const currentStatus = data.status || 'pending';

        if (now - updatedAtTime > 120000) {
          lastPrescriptionStatusMap.set(reqId, currentStatus);
          lastPrescriptionTimeMap.set(reqId, updatedAtTime);
          continue;
        }

        const lastTime = lastPrescriptionTimeMap.get(reqId) || 0;
        if (prevStatus === currentStatus && updatedAtTime <= lastTime) {
          continue;
        }

        lastPrescriptionStatusMap.set(reqId, currentStatus);
        lastPrescriptionTimeMap.set(reqId, updatedAtTime);

        const { customerId, restaurantId, chatId, restaurantName, customerName } = data;

        if (change.type === 'added') {
          // A completely new prescription uploaded by customer -> Send to pharmacy owner
          try {
            const restaurant = await this.prisma.restaurant.findFirst({
              where: { firebaseId: restaurantId },
              select: { ownerId: true, name: true }
            });

            if (restaurant && restaurant.ownerId) {
              this.logger.log(`Sending Prescription Upload Push Notification to Vendor (Owner of restaurant ${restaurantId})`);
              await this.notificationsService.createNotification(
                restaurant.ownerId,
                'طلب روشتة جديد',
                `قام العميل ${customerName || ''} برفع روشتة جديدة للمراجعة.`,
                'prescription_new',
                {
                  screen: 'pharmacy_chat',
                  chatId: chatId,
                  requestId: reqId,
                  pharmacyName: restaurant.name || restaurantName || 'الصيدلية',
                  type: 'prescription_new'
                }
              );
            }
          } catch (err) {
            this.logger.error(`Error sending prescription upload notification to vendor: ${err.message}`);
          }
        } else if (change.type === 'modified') {
          // Status updated to quoted -> Send to Customer
          if (currentStatus === 'quoted' && prevStatus !== 'quoted') {
            try {
              const customer = await this.prisma.user.findFirst({
                where: { firebaseUid: customerId },
                select: { id: true }
              });

              if (customer) {
                this.logger.log(`Sending Prescription Quoted (Review) Push Notification to Customer ${customerId}`);
                await this.notificationsService.createNotification(
                  customer.id,
                  'عرض سعر الروشتة جاهز',
                  `تمت مراجعة وتسعير الروشتة من قبل ${restaurantName || 'الصيدلية'}. يمكنك مراجعة العرض وقبوله الآن.`,
                  'prescription_review',
                  {
                    screen: 'pharmacy_chat',
                    chatId: chatId,
                    requestId: reqId,
                    pharmacyName: restaurantName || 'الصيدلية',
                    type: 'prescription_review'
                  }
                );
              }
            } catch (err) {
              this.logger.error(`Error sending prescription quoted notification to customer: ${err.message}`);
            }
          }
        }
      }
    }, (error) => {
      this.logger.error('Error listening to Firebase prescription requests:', error);
    });

    // 11. Initial syncs are handled automatically by onSnapshot when it first attaches
  }

  private async syncOrder(doc: any, silent = false, isNew = false) {
    try {
      const data = doc.data();
      if (!silent) {
        this.logger.log(`Syncing Firebase order: ${doc.id}`);
      }

      // 1. Resolve Customer
      let customerId: string | null = null;
      if (data.customerId) {
        let user = await this.prisma.user.findFirst({
          where: { firebaseUid: data.customerId }
        });
        
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
            // Create skeleton user if not in Auth
            user = await this.prisma.user.create({
              data: {
                firebaseUid: data.customerId,
                email: `${data.customerId}@temp.zspeed.com`,
                name: data.customerName || 'Z-SPEED Customer',
                role: 'CUSTOMER',
              }
            });
          }
        }

        if (user) customerId = user.id;
      }

      if (!customerId) {
        this.logger.error(`Could not resolve customer for order ${doc.id}`);
        return;
      }

      // 2. Resolve Restaurant
      let restaurantId: string | null = null;
      if (data.restaurantId) {
        const restaurant = await this.prisma.restaurant.findFirst({
          where: { firebaseId: data.restaurantId }
        });
        if (restaurant) restaurantId = restaurant.id;
      }

      if (!restaurantId) {
        this.logger.error(`Could not resolve restaurant for order ${doc.id} (Firebase ID: ${data.restaurantId})`);
        return;
      }

      // 3. Resolve Items
      const itemsToCreate = [];
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          let foodItemId: string | null = null;
          if (item.menuItemId || item.id) {
            const fbId = item.menuItemId || item.id;
            const dbItem = await this.prisma.foodItem.findFirst({
              where: { firebaseId: fbId }
            });
            if (dbItem) foodItemId = dbItem.id;
          }

          if (foodItemId) {
            itemsToCreate.push({
              foodItem: { connect: { id: foodItemId } }, 
              quantity: item.quantity || 1,
              unitPrice: item.price || 0,
              specialNote: item.name || 'Synced Item',
            });
          }
        }
      }

      // 4. Create or Update Order in PostgreSQL
      // ── Financial Calculation (uses Admin Settings) ─────────────────────────
      // Load system config so Firebase orders obey the same fee rules as web orders
      const sysConfig = await this.prisma.systemConfig.findFirst();
      const platformFeePercent = sysConfig?.platformFeePercent ?? 2.0;
      const commissionRate     = sysConfig?.defaultAppCommissionRate ?? 0.20;

      const rawDeliveryFee = Number(data.deliveryFee || data.delivery_fee || 0);
      const rawTax         = Number(data.tax || data.tax_amount || 0);
      const rawDiscount    = Number(data.discount || 0);

      // Subtotal: prefer explicit field, otherwise back-calculate from total
      const rawSubtotal = data.subtotal
        ? Number(data.subtotal)
        : (data.total
            ? Math.max(0, Number(data.total) - rawDeliveryFee - Number(data.serviceFee ?? data.service_fee ?? 0) - rawTax)
            : 0);

      // serviceFee: use what Firebase sent; if absent, compute from platformFeePercent (admin setting)
      const rawServiceFee = (data.serviceFee != null || data.service_fee != null)
        ? Number(data.serviceFee ?? data.service_fee)
        : Math.round(rawSubtotal * (platformFeePercent / 100) * 100) / 100;

      const rawTotal = data.total
        ? Number(data.total)
        : Math.round((rawSubtotal + rawDeliveryFee + rawServiceFee - rawDiscount + rawTax) * 100) / 100;

      // Pre-compute financial shares — saved immediately so Admin Panel shows full breakdown.
      // These are recalculated precisely again when order reaches DELIVERED.
      const appCommission   = Math.round(rawSubtotal * commissionRate * 100) / 100;
      const restaurantShare = Math.round((rawSubtotal - appCommission) * 100) / 100;
      const driverShare     = rawDeliveryFee;
      const appShare        = Math.round((appCommission + rawServiceFee) * 100) / 100;

      this.logger.log(
        `💰 Order ${doc.id} — subtotal:${rawSubtotal} delivery:${rawDeliveryFee} ` +
        `serviceFee:${rawServiceFee}(${platformFeePercent}%) total:${rawTotal} ` +
        `| commission:${appCommission}(${commissionRate*100}%) resto:${restaurantShare} app:${appShare}`
      );
      // ─────────────────────────────────────────────────────────────────────────

      const order = await this.prisma.order.upsert({
        where: { firebaseOrderId: doc.id },
        update: {
          status:      this.mapFirebaseToPostgresStatus(data.status) || OrderStatus.PENDING,
          subtotal:    rawSubtotal,
          deliveryFee: rawDeliveryFee,
          serviceFee:  rawServiceFee,
          tax:         rawTax,
          total:       rawTotal,
          paymentState: data.paymentState === 'paid' ? PaymentState.PAID : PaymentState.PENDING,
          deliveryAddress: data.deliveryAddress || 'Synced Address',
          // Keep shares current while order is in-progress
          appCommission,
          restaurantShare,
          driverShare,
          appShare,
          updatedAt: new Date(),
        },
        create: {
          customerId,
          restaurantId,
          firebaseOrderId: doc.id,
          status:      this.mapFirebaseToPostgresStatus(data.status) || OrderStatus.PENDING,
          subtotal:    rawSubtotal,
          deliveryFee: rawDeliveryFee,
          serviceFee:  rawServiceFee,
          tax:         rawTax,
          discount:    rawDiscount,
          total:       rawTotal,
          paymentMethod: (data.paymentMethod || 'CASH').toUpperCase(),
          paymentState: data.paymentState === 'paid' ? PaymentState.PAID : PaymentState.PENDING,
          deliveryAddress: data.deliveryAddress || 'Synced Address',
          deliveryLat: data.deliveryLat || 30.0444,
          deliveryLng: data.deliveryLng || 31.2357,
          customerNote: data.customerNote ? `${data.customerNote}\n[Firebase: ${doc.id}]` : `[Firebase: ${doc.id}]`,
          appCommission,
          restaurantShare,
          driverShare,
          appShare,
          items: { create: itemsToCreate }
        },
        include: {
          items: { include: { foodItem: true } },
          customer: true,
        }
      });

      // 5. Broadcast to Vendor Dashboard — only for genuinely new orders
      if (isNew) {
        this.gateway.emitToVendor(restaurantId, 'order:new', order);
      }

      // 6. Mark as synced in Firebase + push back corrected fee values
      //    so the mobile app always reflects server-computed fees (admin settings)
      await doc.ref.update({
        syncedToPostgres: true,
        postgresOrderId:  order.id,
        serviceFee:       rawServiceFee,
        appCommission,
        restaurantShare,
        appShare,
      });

    } catch (error) {
      this.logger.error(`Failed to sync Firebase order ${doc.id}:`, error.stack);
    }
  }

  private async syncRestaurant(doc: any) {
    const data = doc.data();
    // Use a flag to avoid redundant logs for already synced restaurants
    const silent = !!data.postgresId; // If we ever add this field to FB
    
    if (!silent) {
      this.logger.debug(`Checking Firebase restaurant: ${data.name || doc.id}`);
    }

    try {
      // 1. Resolve Owner (Vendor User)
      let ownerId: string | null = null;
      
      // In many Firebase setups, there is an ownerId field. If not, we might use doc.id as ownerId if it matches UID
      const firebaseOwnerId = data.ownerId || data.userId || doc.id; 

      let user = await this.prisma.user.findFirst({
        where: { firebaseUid: firebaseOwnerId }
      });

      if (!user) {
        // Try fetching from Firebase Auth
        try {
          const authUser = await this.firebaseAdmin.getAuth().getUser(firebaseOwnerId);
          if (authUser) {
            user = await this.prisma.user.upsert({
              where: { firebaseUid: authUser.uid },
              update: {
                name: authUser.displayName || data.name || 'Vendor User',
                phone: authUser.phoneNumber || data.phone || null,
              },
              create: {
                firebaseUid: authUser.uid,
                email: authUser.email || `${authUser.uid}@vendor.zspeed.com`,
                name: authUser.displayName || data.name || 'Vendor User',
                phone: authUser.phoneNumber || data.phone || null,
                role: 'VENDOR',
              }
            });
            this.logger.log(`Synced Vendor User in Postgres: ${user.id}`);
          }
        } catch (err) {
          // If not in Auth, create/update a skeleton user
          user = await this.prisma.user.upsert({
            where: { firebaseUid: firebaseOwnerId },
            update: {
              name: data.name || 'Vendor User',
            },
            create: {
              firebaseUid: firebaseOwnerId,
              email: `${firebaseOwnerId}@vendor.zspeed.com`,
              name: data.name || 'Vendor User',
              role: 'VENDOR',
            }
          });
          this.logger.log(`Synced Skeleton Vendor User in Postgres: ${user.id}`);
        }
      }

      if (!user) {
        this.logger.error(`Could not resolve owner for restaurant ${doc.id}`);
        return;
      }

      ownerId = user.id;

      // 2. Create or Update Restaurant
      await this.prisma.restaurant.upsert({
        where: { firebaseId: doc.id },
        update: {
          name: data.name || 'Synced Restaurant',
          nameAr: data.nameAr || null,
          description: data.description || null,
          logoUrl: data.logoUrl || data.image || data.imageUrl || data.logo || null,
          coverImageUrl: data.coverImageUrl || data.coverImage || data.image || data.imageUrl || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
          isOpen: data.isOpen !== undefined ? data.isOpen : true,
          vendorType: data.vendorType || 'restaurant',
          address: data.address || null,
          city: data.city || null,
          latitude: safeParseFloat(data.latitude),
          longitude: safeParseFloat(data.longitude),
          deliveryRadiusKm: safeParseFloat(data.deliveryRadiusKm),
          deliveryTimeMin: safeParseInt(data.deliveryTimeMin),
          deliveryTimeMax: safeParseInt(data.deliveryTimeMax),
          deliveryFeeMode: data.deliveryFeeMode || null,
          deliveryFee: safeParseFloat(data.deliveryFee, 0.0)!,
          minimumOrder: safeParseFloat(data.minimumOrder, 0.0)!,
          deliveryFeeFormula: data.deliveryFeeFormula || null,
          deliveryFeeTiers: data.deliveryFeeTiers || null,
        },
        create: {
          firebaseId: doc.id,
          ownerId: ownerId,
          name: data.name || 'Synced Restaurant',
          nameAr: data.nameAr || null,
          description: data.description || null,
          logoUrl: data.logoUrl || data.image || data.imageUrl || data.logo || null,
          coverImageUrl: data.coverImageUrl || data.coverImage || data.image || data.imageUrl || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
          isOpen: data.isOpen !== undefined ? data.isOpen : true,
          vendorType: data.vendorType || 'restaurant',
          address: data.address || null,
          city: data.city || null,
          latitude: safeParseFloat(data.latitude),
          longitude: safeParseFloat(data.longitude),
          deliveryRadiusKm: safeParseFloat(data.deliveryRadiusKm),
          deliveryTimeMin: safeParseInt(data.deliveryTimeMin),
          deliveryTimeMax: safeParseInt(data.deliveryTimeMax),
          deliveryFeeMode: data.deliveryFeeMode || null,
          deliveryFee: safeParseFloat(data.deliveryFee, 0.0)!,
          minimumOrder: safeParseFloat(data.minimumOrder, 0.0)!,
          deliveryFeeFormula: data.deliveryFeeFormula || null,
          deliveryFeeTiers: data.deliveryFeeTiers || null,
          status: 'ACTIVE',
        }
      });

      // Success log removed to prevent spam

    } catch (error) {
      this.logger.error(`Error syncing restaurant ${doc.id}:`, error);
    }
  }

  // Initial sync to catch up on all existing restaurants
  private async initialSyncRestaurants() {
    this.logger.log('Performing initial sync of all Firebase restaurants...');
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      const snapshot = await firestore.collection('restaurants').get();
      for (const doc of snapshot.docs) {
        await this.syncRestaurant(doc);
      }
      this.logger.log(`✅ Initial sync completed: ${snapshot.size} restaurants processed.`);
    } catch (error) {
      this.logger.error('Failed during initial restaurant sync:', error);
    }
  }

  // Sync Menu Sections FROM Firebase TO Postgres
  private async syncMenuSection(doc: any) {
    const data = doc.data();
    const path = doc.ref.path; // e.g., restaurants/RES_ID/menuSections/SEC_ID
    const pathParts = path.split('/');
    const fbRestaurantId = pathParts[1];

    try {
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { firebaseId: fbRestaurantId }
      });

      if (!restaurant) {
        return;
      }

      // Loop prevention check
      const existing = await this.prisma.menuSection.findUnique({
        where: { firebaseId: doc.id }
      });

      if (existing) {
        const isNameEqual = existing.name === (data.name || 'Synced Section') && existing.nameAr === (data.nameAr || null);
        const isActiveEqual = existing.isActive === (data.isActive !== undefined ? data.isActive : true);
        const isSortEqual = existing.sortOrder === (data.sortOrder || 0);

        if (isNameEqual && isActiveEqual && isSortEqual) {
          // Identical, skip updates to prevent infinite loops
          return;
        }
      }

      await this.prisma.menuSection.upsert({
        where: { firebaseId: doc.id },
        update: {
          name: data.name || 'Synced Section',
          nameAr: data.nameAr || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
          sortOrder: data.sortOrder || 0,
        },
        create: {
          firebaseId: doc.id,
          restaurantId: restaurant.id,
          name: data.name || 'Synced Section',
          nameAr: data.nameAr || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
          sortOrder: data.sortOrder || 0,
        }
      });
    } catch (error) {
      this.logger.error(`Error syncing menu section ${doc.id}:`, error);
    }
  }

  // Sync Food Items FROM Firebase TO Postgres
  private async syncFoodItem(doc: any) {
    const data = doc.data();
    const path = doc.ref.path; // e.g., restaurants/RES_ID/menuSections/SEC_ID/items/ITEM_ID
    const pathParts = path.split('/');
    const fbSectionId = pathParts[3];

    try {
      const section = await this.prisma.menuSection.findUnique({
        where: { firebaseId: fbSectionId }
      });

      if (!section) {
        return;
      }

      // Loop prevention check
      const existing = await this.prisma.foodItem.findUnique({
        where: { firebaseId: doc.id },
        include: { variants: true }
      });

      if (existing) {
        const isNameEqual = existing.name === (data.name || 'Synced Item') && existing.nameAr === (data.nameAr || null);
        const isDescEqual = existing.description === (data.description || null) && existing.descriptionAr === (data.descriptionAr || null);
        const isPriceEqual = existing.price === (data.price || data.unitPrice || 0) && existing.originalPrice === (data.originalPrice || null);
        const isAvailableEqual = existing.isAvailable === (data.isAvailable !== undefined ? data.isAvailable : true);
        const isStockEqual = existing.stockQuantity === (data.stockQuantity || 0);
        const isFractionEqual = existing.hasFractions === (data.hasFractions || false) &&
                                 existing.fractionUnitName === (data.fractionUnitName || null) &&
                                 existing.fractionUnitNameAr === (data.fractionUnitNameAr || null) &&
                                 existing.unitsPerParent === (data.unitsPerParent || null) &&
                                 existing.fractionPrice === (data.fractionPrice || null);
        
        let isVariantsEqual = true;
        if (data.variants && Array.isArray(data.variants)) {
          if (existing.variants.length !== data.variants.length) {
            isVariantsEqual = false;
          } else {
            for (const v of data.variants) {
              const match = existing.variants.find(dbV => dbV.id === (v.id || v.firebaseId));
              if (!match) {
                isVariantsEqual = false;
                break;
              }
              if (match.name !== v.name || 
                  match.nameAr !== (v.nameAr || null) ||
                  match.price !== (v.price || 0) || 
                  match.originalPrice !== (v.originalPrice || null) ||
                  match.stockQuantity !== (v.stockQuantity || 0) || 
                  match.isAvailable !== (v.isAvailable !== undefined ? v.isAvailable : true) ||
                  match.isFraction !== (v.isFraction || false) ||
                  match.fractionMultiplier !== (v.fractionMultiplier || null)) {
                isVariantsEqual = false;
                break;
              }
            }
          }
        } else {
          if (existing.variants.length > 0) {
            isVariantsEqual = false;
          }
        }

        if (isNameEqual && isDescEqual && isPriceEqual && isAvailableEqual && isStockEqual && isFractionEqual && isVariantsEqual) {
          // Fields are identical! Skip PG update to prevent infinite loops.
          return;
        }
      }

      // Upsert the food item
      const foodItem = await this.prisma.foodItem.upsert({
        where: { firebaseId: doc.id },
        update: {
          name: data.name || 'Synced Item',
          nameAr: data.nameAr || null,
          description: data.description || null,
          descriptionAr: data.descriptionAr || null,
          imageUrl: data.imageUrl || data.image || data.itemImage || null,
          price: data.price || data.unitPrice || 0,
          originalPrice: data.originalPrice || null,
          isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
          stockQuantity: data.stockQuantity || 0,
          hasFractions: data.hasFractions || false,
          fractionUnitName: data.fractionUnitName || null,
          fractionUnitNameAr: data.fractionUnitNameAr || null,
          unitsPerParent: data.unitsPerParent || null,
          fractionPrice: data.fractionPrice || null,
          addons: data.addons || data.addonGroups || null,
          allergens: data.allergens || [],
          prepTimeMin: data.prepTimeMin || 10,
          unit: data.unit || null,
          tags: data.tags || [],
        },
        create: {
          firebaseId: doc.id,
          sectionId: section.id,
          name: data.name || 'Synced Item',
          nameAr: data.nameAr || null,
          description: data.description || null,
          descriptionAr: data.descriptionAr || null,
          imageUrl: data.imageUrl || data.image || data.itemImage || null,
          price: data.price || data.unitPrice || 0,
          originalPrice: data.originalPrice || null,
          isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
          stockQuantity: data.stockQuantity || 0,
          hasFractions: data.hasFractions || false,
          fractionUnitName: data.fractionUnitName || null,
          fractionUnitNameAr: data.fractionUnitNameAr || null,
          unitsPerParent: data.unitsPerParent || null,
          fractionPrice: data.fractionPrice || null,
          addons: data.addons || data.addonGroups || null,
          allergens: data.allergens || [],
          prepTimeMin: data.prepTimeMin || 10,
          unit: data.unit || null,
          tags: data.tags || [],
        }
      });

      // Synchronize variants
      if (data.variants && Array.isArray(data.variants)) {
        const activeVariantIds: string[] = [];

        for (const variantData of data.variants) {
          const vId = variantData.id || variantData.firebaseId;
          if (!vId) continue;

          const dbVariant = await this.prisma.foodItemVariant.upsert({
            where: { id: vId },
            update: {
              name: variantData.name,
              nameAr: variantData.nameAr || null,
              price: variantData.price || 0,
              originalPrice: variantData.originalPrice || null,
              stockQuantity: variantData.stockQuantity || 0,
              isAvailable: variantData.isAvailable !== undefined ? variantData.isAvailable : true,
              isFraction: variantData.isFraction || false,
              fractionMultiplier: variantData.fractionMultiplier || null,
              firebaseId: vId,
            },
            create: {
              id: vId,
              foodItemId: foodItem.id,
              name: variantData.name,
              nameAr: variantData.nameAr || null,
              price: variantData.price || 0,
              originalPrice: variantData.originalPrice || null,
              stockQuantity: variantData.stockQuantity || 0,
              isAvailable: variantData.isAvailable !== undefined ? variantData.isAvailable : true,
              isFraction: variantData.isFraction || false,
              fractionMultiplier: variantData.fractionMultiplier || null,
              firebaseId: vId,
            }
          });
          activeVariantIds.push(dbVariant.id);
        }

        // Delete variants not present in Firestore
        await this.prisma.foodItemVariant.deleteMany({
          where: {
            foodItemId: foodItem.id,
            id: { notIn: activeVariantIds }
          }
        });
      } else {
        await this.prisma.foodItemVariant.deleteMany({
          where: { foodItemId: foodItem.id }
        });
      }
    } catch (error) {
      this.logger.error(`Error syncing food item ${doc.id}:`, error);
    }
  }

  // Sync Drivers FROM Firebase TO Postgres
  private async syncDriver(doc: any) {
    const data = doc.data();
    const uid = doc.id;

    try {
      // 1. Create or Update User record
      let user = await this.prisma.user.findFirst({
        where: { OR: [{ firebaseUid: uid }, { email: data.email }] }
      });

      const userData = {
        firebaseUid: uid,
        email: data.email || `${uid}@driver.zspeed.com`,
        name: data.name || data.fullName || 'Driver User',
        phone: data.phone || data.phoneNumber || null,
        role: 'DRIVER' as any,
        profileImage: data.profileImage || data.imageUrl || null,
        walletBalance: safeParseFloat(data.walletBalance, 0.0)!,
      };

      if (!user) {
        try {
          const authUser = await this.firebaseAdmin.getAuth().getUser(uid);
          userData.email = authUser.email || userData.email;
          userData.name = authUser.displayName || userData.name;
          userData.phone = authUser.phoneNumber || userData.phone;
        } catch (e) {}
        user = await this.prisma.user.create({ data: userData });
      } else {
        // Update existing user to keep name/phone/wallet in sync
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            name: userData.name,
            phone: userData.phone,
            profileImage: userData.profileImage,
            walletBalance: safeParseFloat(data.walletBalance, undefined)!,
          }
        });
      }

      // Flexible mapping for location and status
      const lat = data.lastLocation?.latitude || data.latitude || data.lat || data.currentLat || null;
      const lng = data.lastLocation?.longitude || data.longitude || data.lng || data.currentLng || null;
      const isOnline = data.online === true || data.isOnline === true || data.status === 'online' || data.isAvailable === true;

      // 2. Create or Update DriverProfile
      const profile = await this.prisma.driverProfile.upsert({
        where: { userId: user.id },
        update: {
          currentLat: safeParseFloat(lat),
          currentLng: safeParseFloat(lng),
          isAvailable: isOnline,
          rating: data.rating || 5.0,
          totalTrips: data.totalTrips || 0,
          lastPingAt: new Date(),
          applicationStatus: 'APPROVED',
          canDeliver: data.canDeliver !== undefined ? data.canDeliver : true,
          canTransport: data.canTransport !== undefined ? data.canTransport : false,
        },
        create: {
          userId: user.id,
          currentLat: safeParseFloat(lat),
          currentLng: safeParseFloat(lng),
          isAvailable: isOnline,
          rating: data.rating || 5.0,
          totalTrips: data.totalTrips || 0,
          lastPingAt: new Date(),
          applicationStatus: 'APPROVED',
          canDeliver: data.canDeliver !== undefined ? data.canDeliver : true,
          canTransport: data.canTransport !== undefined ? data.canTransport : false,
        }
      });

      // 3. Create or Update Vehicle
      if (data.vehicle || data.vehicleInfo) {
        const v = data.vehicle || data.vehicleInfo;
        await this.prisma.vehicle.upsert({
          where: { driverProfileId: profile.id },
          update: {
            type: v.type || v.vehicleType || 'MOTORCYCLE',
            make: v.make || v.brand || null,
            model: v.model || null,
            plateNumber: v.plateNumber || v.licensePlate || null,
            color: v.color || null,
          },
          create: {
            driverProfileId: profile.id,
            type: v.type || v.vehicleType || 'MOTORCYCLE',
            make: v.make || v.brand || null,
            model: v.model || null,
            plateNumber: v.plateNumber || v.licensePlate || null,
            color: v.color || null,
          }
        });
      }

      // Success log removed to prevent spam

    } catch (error) {
      this.logger.error(`Error syncing driver ${uid}:`, error);
    }
  }

  private async initialSyncDrivers() {
    this.logger.log('Performing initial sync of all Firebase drivers...');
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      const snapshot = await firestore.collection('driverProfiles').get();
      for (const doc of snapshot.docs) {
        await this.syncDriver(doc);
      }
      this.logger.log(`✅ Initial driver sync completed: ${snapshot.size} drivers processed.`);
    } catch (error) {
      this.logger.error('Failed during initial driver sync:', error);
    }
  }

  private async syncUserAddress(doc: any) {
    const data = doc.data();
    const path = doc.ref.path; // e.g., users/USER_UID/addresses/ADDR_ID
    const pathParts = path.split('/');
    const fbUserId = pathParts[1];

    try {
      const user = await this.prisma.user.findFirst({
        where: { firebaseUid: fbUserId }
      });

      if (!user) return;

      await this.prisma.address.upsert({
        where: { id: doc.id }, // Assuming doc.id is the UUID used in Postgres or we use a mapping
        update: {
          label: data.label || data.name || null,
          street: data.street || data.address || 'Synced Address',
          building: data.building || null,
          floor: data.floor || null,
          apartment: data.apartment || null,
          city: data.city || 'Cairo',
          latitude: data.latitude || data.lat || 0,
          longitude: data.longitude || data.lng || 0,
          isDefault: data.isDefault || false,
          type: data.type || 'home',
        },
        create: {
          id: doc.id,
          userId: user.id,
          label: data.label || data.name || null,
          street: data.street || data.address || 'Synced Address',
          building: data.building || null,
          floor: data.floor || null,
          apartment: data.apartment || null,
          city: data.city || 'Cairo',
          latitude: data.latitude || data.lat || 0,
          longitude: data.longitude || data.lng || 0,
          isDefault: data.isDefault || false,
          type: data.type || 'home',
        }
      });
    } catch (error) {
      // Quiet fail to prevent log spam
    }
  }

  private async initialSyncAddresses() {
    this.logger.log('Performing initial sync of all Firebase user addresses...');
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      const snapshot = await firestore.collectionGroup('addresses').get();
      for (const doc of snapshot.docs) {
        await this.syncUserAddress(doc);
      }
      this.logger.log(`✅ Initial address sync completed: ${snapshot.size} addresses processed.`);
    } catch (error) {
      this.logger.error('Failed during initial address sync:', error);
    }
  }

  // Initial sync for Menu (Sections and Items)
  private async initialSyncMenu() {
    this.logger.log('Performing initial sync of all Firebase menu sections and items...');
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      // 1. Sync all sections
      const sectionSnapshot = await firestore.collectionGroup('menuSections').get();
      for (const doc of sectionSnapshot.docs) {
        await this.syncMenuSection(doc);
      }

      // 2. Sync all items
      const itemSnapshot = await firestore.collectionGroup('items').get();
      for (const doc of itemSnapshot.docs) {
        await this.syncFoodItem(doc);
      }

      this.logger.log(`✅ Initial menu sync completed: ${sectionSnapshot.size} sections and ${itemSnapshot.size} items processed.`);
    } catch (error) {
      this.logger.error('Failed during initial menu sync:', error);
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
        // Validate transition via state machine for logging/warning purposes
        if (!this.stateMachine.canTransition(order.status, targetStatus, 'DRIVER' as any)) {
          this.logger.warn(`Firebase status sync warning: transition ${order.status} → ${targetStatus} for order ${postgresOrderId} is technically invalid but forcing sync to ensure consistency.`);
        }
        
        this.logger.log(`🔄 Syncing status change FROM Firebase: ${firebaseStatus} -> ${targetStatus} for Order ${postgresOrderId}`);

        const updatedOrder = await this.prisma.order.update({
          where: { id: postgresOrderId },
          data: {
            status: targetStatus,
            ...(targetStatus === OrderStatus.PICKED_UP ? { pickedUpAt: new Date() } : {}),
            ...(targetStatus === OrderStatus.OUT_FOR_DELIVERY ? { outForDeliveryAt: new Date() } : {}),
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
      case 'pending':          return OrderStatus.PENDING;
      case 'accepted':         return OrderStatus.CONFIRMED;
      case 'preparing':        return OrderStatus.PREPARING;
      case 'ready':            return OrderStatus.READY;
      case 'ready_for_pickup': return OrderStatus.READY_FOR_PICKUP;
      case 'picked_up':        return OrderStatus.PICKED_UP;
      case 'in_transit':       return OrderStatus.IN_TRANSIT;
      case 'arrived':          return OrderStatus.ARRIVED;
      case 'on_the_way':       return OrderStatus.OUT_FOR_DELIVERY;
      case 'out_for_delivery': return OrderStatus.OUT_FOR_DELIVERY;
      case 'delivered':        return OrderStatus.DELIVERED;
      case 'cancelled':        return OrderStatus.CANCELLED;
      default:                 return null;
    }
  }

  // Simplified version of OrdersService.handleDelivered — MUST stay in sync with it
  private async handleOrderDeliveredInternal(order: any) {
    this.logger.log(`💰 Processing earnings for delivered order ${order.id}`);

    try {
      // Idempotency guard: skip if already settled
      const existingSettlement = await this.prisma.ledger.findFirst({
        where: { orderId: order.id, type: 'EARNING' },
      });
      if (existingSettlement) {
        this.logger.warn(`Order ${order.id} already settled (Firebase path). Skipping.`);
        return;
      }

      const config = await this.prisma.systemConfig.findFirst() || {} as any;

      // Unified split: Restaurant = subtotal (100%), App = serviceFee only
      // MUST match orders.service.ts handleDelivered exactly
      const restaurantShare = order.subtotal;
      const appCommission   = 0;
      const driverShare     = order.deliveryFee + (order.driverBoost || 0) + (order.tips || 0);
      const appShare        = order.serviceFee || 0;

      const isCash = order.paymentMethod === 'CASH';
      const cashCollected = isCash ? order.total : 0;

      this.logger.log(`📊 Order ${order.id}: Resto=${restaurantShare}, Driver=${driverShare}, App=${appShare}, Cash=${cashCollected}`);

      // Update order financials
      await this.prisma.order.update({
        where: { id: order.id },
        data: { appCommission, restaurantShare, driverShare, appShare, cashCollected },
      });

      // Restaurant earnings
      if (order.restaurantId) {
        await this.prisma.restaurant.update({
          where: { id: order.restaurantId },
          data: {
            pendingBalance: { increment: restaurantShare },
            totalEarnings:  { increment: restaurantShare },
          },
        });
        if (order.restaurant?.ownerId) {
          await this.prisma.ledger.create({
            data: {
              userId:    order.restaurant.ownerId,
              orderId:   order.id,
              type:      'EARNING',
              amount:    restaurantShare,
              status:    'pending',
              signature: SignatureUtil.signLedgerEntry({ userId: order.restaurant.ownerId, orderId: order.id, type: 'EARNING', amount: restaurantShare }),
            },
          });
        }
      }

      // Driver earnings
      if (order.driverId) {
        const driver = await this.prisma.driverProfile.findUnique({
          where: { id: order.driverId },
          include: { user: true },
        });
        if (driver) {
          const debtIncrease  = isCash ? cashCollected - driverShare : 0;
          const walletIncrease = isCash ? 0 : driverShare;
          const debtLimit = config?.driverDebtLimit ?? 1000;
          const newDebt = driver.debtBalance + debtIncrease;

          await this.prisma.driverProfile.update({
            where: { id: driver.id },
            data: {
              totalEarnings: { increment: driverShare },
              debtBalance:   { increment: debtIncrease },
              totalTrips:    { increment: 1 },
              isAvailable:   newDebt >= debtLimit ? false : driver.isAvailable,
            },
          });
          if (newDebt >= debtLimit) {
            this.logger.warn(`Driver ${driver.id} suspended — debt limit reached.`);
          }
          if (walletIncrease > 0) {
            await this.prisma.user.update({
              where: { id: driver.userId },
              data: { walletBalance: { increment: walletIncrease } },
            });
          }
          await this.prisma.ledger.create({
            data: {
              userId:    driver.userId,
              orderId:   order.id,
              type:      'EARNING',
              amount:    driverShare,
              status:    'pending',
              signature: SignatureUtil.signLedgerEntry({ userId: driver.userId, orderId: order.id, type: 'EARNING', amount: driverShare }),
            },
          });
          if (isCash && debtIncrease > 0) {
            await this.prisma.ledger.create({
              data: {
                userId:    driver.userId,
                orderId:   order.id,
                type:      'DEBT',
                amount:    debtIncrease,
                status:    'pending',
                signature: SignatureUtil.signLedgerEntry({ userId: driver.userId, orderId: order.id, type: 'DEBT', amount: debtIncrease }),
              },
            });
          }

          // Sync driver stats back to Firestore directly to avoid circular dependency
          try {
            const db = this.firebaseAdmin.getFirestore();
            if (db) {
              const driverUser = await this.prisma.user.findUnique({
                where: { id: driver.userId },
                include: { driverProfile: true },
              });
              if (driverUser && driverUser.firebaseUid) {
                const wBal = Number(driverUser.walletBalance || 0);
                await db.collection('users').doc(driverUser.firebaseUid).update({
                  walletBalance: wBal,
                }).catch(() => {});
                
                if (driverUser.driverProfile) {
                  const dp = driverUser.driverProfile;
                  await db.collection('driverProfiles').doc(driverUser.firebaseUid).set({
                    walletBalance: wBal,
                    totalEarnings: Number(dp.totalEarnings || 0),
                    totalTrips: Number(dp.totalTrips || 0),
                    acceptanceRate: Number(dp.acceptanceRate || 100),
                    rating: Number(dp.rating || 5.0),
                  }, { merge: true }).catch(() => {});
                }
              }
            }
          } catch (err) {
            this.logger.error(`Failed to sync driver stats to Firestore in sync service: ${err.message}`);
          }
        }
      }

      // Loyalty Points (same formula as OrdersService.handleDelivered)
      if (order.customerId) {
        const loyaltyRate   = config?.loyaltyPointsPerEGP ?? 1.0;
        const pointsEarned  = Math.floor(order.total * loyaltyRate);
        if (pointsEarned > 0) {
          await this.ordersService.awardLoyaltyPointsForOrder(order.customerId, pointsEarned);
        }
      }

      // Close active prescription chat if this is a pharmacy order
      if (order.restaurant && order.restaurant.vendorType === 'pharmacy') {
        await this.closePrescriptionChat(order.customerId, order.restaurantId).catch(() => {});
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

  // Closes the live prescription chat once the order is delivered
  async closePrescriptionChat(customerId: string, restaurantId: string) {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      const customerUser = await this.prisma.user.findUnique({
        where: { id: customerId }
      });
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { id: restaurantId }
      });

      if (customerUser && restaurant) {
        const chatId = `chat_cust_${customerUser.firebaseUid}_pharm_${restaurant.firebaseId}`;
        await firestore.collection('chats').doc(chatId).update({
          isOpen: false,
          updatedAt: new Date(),
        }).catch(() => {});
        this.logger.log(`Successfully closed pharmacy chat ${chatId} upon order delivery.`);
      }
    } catch (e) {
      this.logger.error('Failed to close pharmacy prescription chat:', e);
    }
  }

  // Handle driver acceptance from Firebase
  private async handleDriverAcceptance(data: any) {
    const { postgresOrderId, driverId: firebaseDriverUid } = data;
    if (!postgresOrderId || !firebaseDriverUid) return;

    this.logger.log(`Driver ${firebaseDriverUid} accepted order ${postgresOrderId}`);

    try {
      // 1. Find Postgres IDs
      const driverUser = await this.prisma.user.findFirst({
        where: { firebaseUid: firebaseDriverUid },
        include: { driverProfile: true }
      });

      if (!driverUser || !driverUser.driverProfile) {
        this.logger.error(`Could not find driver profile for Firebase UID: ${firebaseDriverUid}`);
        return;
      }

      const driverProfileId = driverUser.driverProfile.id;

      // 2. Check if order already has a driver
      const existingOrder = await this.prisma.order.findUnique({
        where: { id: postgresOrderId }
      });

      if (existingOrder?.driverId) {
        this.logger.warn(`Order ${postgresOrderId} already assigned to driver ${existingOrder.driverId}. Rejecting late acceptance.`);
        return;
      }

      // 3. Only assign driver if current order status allows it (prevent status downgrade)
      if (!existingOrder) {
        this.logger.error(`Order ${postgresOrderId} not found for driver assignment.`);
        return;
      }

      const allowedForAssignment: OrderStatus[] = [
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.READY,
        OrderStatus.READY_FOR_PICKUP,
      ];
      if (!allowedForAssignment.includes(existingOrder.status)) {
        this.logger.warn(`Order ${postgresOrderId} is in status ${existingOrder.status} — driver assignment from Firebase ignored.`);
        return;
      }

      // Only update status to CONFIRMED if order is still PENDING (don't downgrade)
      const updatedOrder = await this.prisma.order.update({
        where: { id: postgresOrderId },
        data: {
          driverId: driverProfileId,
          ...(existingOrder.status === OrderStatus.PENDING ? { status: OrderStatus.CONFIRMED } : {}),
        },
        include: {
          driver: { include: { user: true } },
          customer: true,
          restaurant: true,
        },
      });

      // 4. Update DeliveryRequest record in Postgres
      await this.prisma.deliveryRequest.updateMany({
        where: { 
          orderId: postgresOrderId,
          driverId: driverProfileId
        },
        data: { status: DeliveryRequestStatus.ACCEPTED }
      });

      // 5. Cancel other delivery requests for this order
      await this.prisma.deliveryRequest.updateMany({
        where: {
          orderId: postgresOrderId,
          driverId: { not: driverProfileId },
          status: DeliveryRequestStatus.PENDING
        },
        data: { status: DeliveryRequestStatus.EXPIRED }
      });

      // 6. Notify Vendor via Socket.io
      this.gateway.emitToVendor(updatedOrder.restaurantId, 'order:status_changed', updatedOrder);
      this.gateway.emitToVendor(updatedOrder.restaurantId, 'order:driver_assigned', {
        orderId: updatedOrder.id,
        driver: updatedOrder.driver
      });

      // 7. Update Firebase order status
      await this.updateFirebaseOrderStatus(postgresOrderId, OrderStatus.CONFIRMED);

      this.logger.log(`✅ Order ${postgresOrderId} successfully assigned to driver ${driverUser.name}`);

    } catch (error) {
      this.logger.error('Failed to handle driver acceptance:', error);
    }
  }

  // Create Delivery Request in Firebase for a specific driver
  async createDeliveryRequestInFirebase(driverId: string, orderId: string, data: any) {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    try {
      // Find driver's firebaseUid
      const driver = await this.prisma.driverProfile.findUnique({
        where: { id: driverId },
        include: { user: true }
      });

      if (!driver || !driver.user.firebaseUid) return;

      const requestId = `${orderId}_${driverId}`;
      await firestore.collection('deliveryRequests').doc(requestId).set({
        orderId: data.firebaseOrderId || orderId,
        postgresOrderId: orderId,
        driverId: driver.user.firebaseUid,
        status: 'pending',
        deliveryFee: data.deliveryFee,
        distance: data.estimatedDistance,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
        restaurantName: data.restaurantName,
        restaurantLogoUrl: data.restaurantLogoUrl || null,
        deliveryAddress: data.deliveryAddress,
        customerName: data.customerName || 'Customer',
        orderTotal: data.orderTotal || 0.0,
        paymentMethod: data.paymentMethod || 'cash',
      });

      this.logger.log(`🚀 Delivery request created in Firebase for driver ${driver.user.firebaseUid}`);
    } catch (error) {
      this.logger.error('Failed to create delivery request in Firebase:', error);
    }
  }

  @Cron('*/5 * * * *')
  async verifyAndReconcileDatabases() {
    this.logger.log('⏰ Starting 5-minute database sync verification cron job...');
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) {
      this.logger.warn('Firestore is not initialized, skipping validation cron.');
      return;
    }

    try {
      // 1. Fetch all Firestore data in bulk
      const fsRestaurantsSnapshot = await firestore.collection('restaurants').get();
      const fsSectionsSnapshot = await firestore.collectionGroup('menuSections').get();
      const fsItemsSnapshot = await firestore.collectionGroup('items').get();

      const fsRestaurantsMap = new Map(fsRestaurantsSnapshot.docs.map(doc => [doc.id, doc]));
      const fsSectionsMap = new Map(fsSectionsSnapshot.docs.map(doc => [doc.id, doc]));
      const fsItemsMap = new Map(fsItemsSnapshot.docs.map(doc => [doc.id, doc]));

      // 2. Fetch all PostgreSQL data
      const pgRestaurants = await this.prisma.restaurant.findMany();
      const pgSections = await this.prisma.menuSection.findMany();
      const pgItems = await this.prisma.foodItem.findMany({ include: { variants: true } });

      let reconciledRestaurants = 0;
      let reconciledSections = 0;
      let reconciledItems = 0;

      // --- RECONCILE RESTAURANTS ---
      for (const pgRest of pgRestaurants) {
        const docId = pgRest.firebaseId || pgRest.id;
        const fsDoc = fsRestaurantsMap.get(docId);

        if (!fsDoc) {
          this.logger.log(`Cron: Restaurant ${pgRest.name} (${docId}) missing in Firestore. Syncing...`);
          await this.writeRestaurantToFirestore(firestore, pgRest);
          reconciledRestaurants++;
        } else {
          const data = fsDoc.data();
          if (data.name !== pgRest.name || data.isActive !== pgRest.isActive || data.isOpen !== pgRest.isOpen) {
            await this.writeRestaurantToFirestore(firestore, pgRest);
            reconciledRestaurants++;
          }
        }
      }

      // --- RECONCILE SECTIONS ---
      for (const pgSec of pgSections) {
        const docId = pgSec.firebaseId || pgSec.id;
        const fsDoc = fsSectionsMap.get(docId);
        
        if (!fsDoc) {
          this.logger.log(`Cron: MenuSection ${pgSec.name} (${docId}) missing in Firestore. Syncing...`);
          await this.writeSectionToFirestore(firestore, pgSec);
          reconciledSections++;
        } else {
          const data = fsDoc.data();
          if (data.name !== pgSec.name || data.nameAr !== pgSec.nameAr || data.isActive !== pgSec.isActive || data.sortOrder !== pgSec.sortOrder) {
            await this.writeSectionToFirestore(firestore, pgSec);
            reconciledSections++;
          }
        }
      }

      // --- RECONCILE ITEMS ---
      for (const pgItem of pgItems) {
        const docId = pgItem.firebaseId || pgItem.id;
        const fsDoc = fsItemsMap.get(docId);

        if (!fsDoc) {
          this.logger.log(`Cron: FoodItem ${pgItem.name} (${docId}) missing in Firestore. Syncing...`);
          await this.writeItemToFirestore(firestore, pgItem);
          reconciledItems++;
        } else {
          const data = fsDoc.data();
          const isNameEqual = data.name === pgItem.name && data.nameAr === pgItem.nameAr;
          const isPriceEqual = data.price === pgItem.price && data.isAvailable === pgItem.isAvailable;
          
          let isVariantsEqual = true;
          const fsVariants = data.variants || [];
          if (fsVariants.length !== pgItem.variants.length) {
            isVariantsEqual = false;
          } else {
            for (const v of pgItem.variants) {
              const fsV = fsVariants.find((fv: any) => fv.id === (v.firebaseId || v.id));
              if (!fsV || fsV.name !== v.name || fsV.price !== v.price || fsV.stockQuantity !== v.stockQuantity) {
                isVariantsEqual = false;
                break;
              }
            }
          }

          if (!isNameEqual || !isPriceEqual || !isVariantsEqual) {
            await this.writeItemToFirestore(firestore, pgItem);
            reconciledItems++;
          }
        }
      }

      // Reverse Check: Firestore to Postgres
      for (const [id, doc] of fsSectionsMap.entries()) {
        const exists = pgSections.some(s => (s.firebaseId === id || s.id === id));
        if (!exists) {
          this.logger.log(`Cron: MenuSection ${doc.data().name} (${id}) missing in Postgres. Syncing...`);
          await this.syncMenuSection(doc);
          reconciledSections++;
        }
      }

      for (const [id, doc] of fsItemsMap.entries()) {
        const exists = pgItems.some(i => (i.firebaseId === id || i.id === id));
        if (!exists) {
          this.logger.log(`Cron: FoodItem ${doc.data().name} (${id}) missing in Postgres. Syncing...`);
          await this.syncFoodItem(doc);
          reconciledItems++;
        }
      }

      this.logger.log(`⏰ Cron Sync Done! Reconciled: ${reconciledRestaurants} restaurants, ${reconciledSections} sections, ${reconciledItems} items.`);
    } catch (error) {
      this.logger.error('Error during database sync verification cron:', error);
    }
  }

  private async writeRestaurantToFirestore(db: any, result: any) {
    const docId = result.firebaseId || result.id;
    const syncData: any = {
      name: result.name,
      nameAr: result.nameAr || null,
      description: result.description || null,
      logoUrl: result.logoUrl || null,
      coverImageUrl: result.coverImageUrl || null,
      isActive: result.isActive,
      isOpen: result.isOpen,
      vendorType: result.vendorType || 'RESTAURANT',
      address: result.address || null,
      city: result.city || null,
      latitude: result.latitude || null,
      longitude: result.longitude || null,
      deliveryRadiusKm: result.deliveryRadiusKm || null,
      deliveryTimeMin: result.deliveryTimeMin || null,
      deliveryTimeMax: result.deliveryTimeMax || null,
      deliveryFeeMode: result.deliveryFeeMode || null,
      deliveryFee: result.deliveryFee || 0.0,
      minimumOrder: result.minimumOrder || 0.0,
      updatedAt: new Date(),
    };
    if (result.deliveryFeeTiers) syncData.deliveryFeeTiers = result.deliveryFeeTiers;
    if (result.deliveryFeeFormula) syncData.deliveryFeeFormula = result.deliveryFeeFormula;
    await db.collection('restaurants').doc(docId).set(syncData, { merge: true }).catch(() => {});
  }

  private async writeSectionToFirestore(db: any, result: any) {
    const docId = result.firebaseId || result.id;
    const restaurantId = result.restaurantId;
    if (!restaurantId) return;

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { firebaseId: true }
    }).catch(() => null);
    const firestoreRestaurantId = restaurant?.firebaseId || restaurantId;

    const syncData = {
      id: docId,
      restaurantId: firestoreRestaurantId,
      name: result.name,
      nameAr: result.nameAr || null,
      isActive: result.isActive,
      sortOrder: result.sortOrder ?? 0,
      updatedAt: new Date(),
    };
    await db.collection('restaurants').doc(firestoreRestaurantId).collection('menuSections').doc(docId).set(syncData, { merge: true }).catch(() => {});
  }

  private async writeItemToFirestore(db: any, result: any) {
    const itemId = result.firebaseId || result.id;
    const sectionId = result.sectionId;
    if (!sectionId) return;

    const section = await this.prisma.menuSection.findUnique({
      where: { id: sectionId },
      select: { 
        restaurantId: true, 
        firebaseId: true,
        restaurant: { select: { firebaseId: true } }
      }
    }).catch(() => null);

    const restaurantId = section?.restaurantId;
    if (!restaurantId) return;

    const firestoreRestaurantId = section?.restaurant?.firebaseId || restaurantId;
    const firestoreSectionId = section?.firebaseId || sectionId;

    const variants = result.variants || await this.prisma.foodItemVariant.findMany({
      where: { foodItemId: result.id }
    }).catch(() => []);

    const syncData = {
      id: itemId,
      sectionId: firestoreSectionId,
      restaurantId: firestoreRestaurantId,
      name: result.name,
      nameAr: result.nameAr || null,
      description: result.description || null,
      descriptionAr: result.descriptionAr || null,
      imageUrl: result.imageUrl || null,
      price: result.price,
      originalPrice: result.originalPrice || null,
      isOnSale: result.isOnSale,
      isAvailable: result.isAvailable,
      stockQuantity: result.stockQuantity,
      hasFractions: result.hasFractions,
      fractionUnitName: result.fractionUnitName || null,
      fractionUnitNameAr: result.fractionUnitNameAr || null,
      unitsPerParent: result.unitsPerParent || null,
      fractionPrice: result.fractionPrice || null,
      addons: result.addons || null,
      allergens: result.allergens || [],
      prepTimeMin: result.prepTimeMin ?? 10,
      unit: result.unit || null,
      tags: result.tags || [],
      updatedAt: new Date(),
      variants: variants.map((v: any) => ({
        id: v.firebaseId || v.id,
        foodItemId: v.foodItemId,
        name: v.name,
        nameAr: v.nameAr || null,
        price: v.price,
        originalPrice: v.originalPrice || null,
        stockQuantity: v.stockQuantity,
        isAvailable: v.isAvailable,
        isFraction: v.isFraction,
        fractionMultiplier: v.fractionMultiplier || null,
        updatedAt: v.updatedAt
      }))
    };

    await db.collection('restaurants').doc(firestoreRestaurantId).collection('menuSections').doc(firestoreSectionId).collection('items').doc(itemId).set(syncData, { merge: true }).catch(() => {});
  }
}
