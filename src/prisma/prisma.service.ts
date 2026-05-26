import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ],
    });

    const admin = require('firebase-admin');
    const self = this;

    const extendedClient = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            let preDeleteData: any = null;

            if (operation === 'delete' || operation === 'deleteMany') {
              try {
                if (model === 'MenuSection') {
                  preDeleteData = await self.menuSection.findFirst({
                    where: args.where,
                    select: { id: true, restaurantId: true }
                  });
                } else if (model === 'FoodItem') {
                  preDeleteData = await self.foodItem.findFirst({
                    where: args.where,
                    select: { id: true, sectionId: true }
                  });
                } else if (model === 'FoodItemVariant') {
                  preDeleteData = await self.foodItemVariant.findFirst({
                    where: args.where,
                    select: { id: true, foodItemId: true }
                  });
                }
              } catch (e) {
                self.logger.warn(`Failed to retrieve pre-delete data for model ${model}: ${e.message}`);
              }
            }

            const result = await query(args);

            // Perform Firestore synchronization post-commit
            try {
              if (admin.apps.length) {
                const db = admin.firestore();
                if (db) {
                  const action = operation;
                  const params = { model, action, args };

                  if (model === 'Restaurant') {
                    await self.syncRestaurantToFirestore(db, action, params, result);
                  } else if (model === 'User') {
                    await self.syncUserToFirestore(db, action, params, result);
                  } else if (model === 'DriverProfile') {
                    await self.syncDriverProfileToFirestore(db, action, params, result);
                  } else if (model === 'MenuSection') {
                    await self.syncMenuSectionToFirestore(db, action, params, result, preDeleteData);
                  } else if (model === 'FoodItem') {
                    await self.syncFoodItemToFirestore(db, action, params, result, preDeleteData);
                  } else if (model === 'FoodItemVariant') {
                    await self.syncFoodItemVariantToFirestore(db, action, params, result, preDeleteData);
                  } else if (model === 'SystemConfig') {
                    await self.syncSystemConfigToFirestore(db, action, params, result);
                  }
                }
              }
            } catch (err) {
              self.logger.warn(`Prisma global Firestore sync failed for model ${model}: ${err.message}`);
            }

            return result;
          }
        }
      }
    });

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in extendedClient) {
          return Reflect.get(extendedClient, prop, receiver);
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Prisma connected to database');
    } catch (error) {
      this.logger.error('❌ Prisma connection failed:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 Prisma disconnected from database');
  }

  private async syncRestaurantToFirestore(db: any, action: string, params: any, result: any) {
    if (action === 'delete' || action === 'deleteMany') {
      const id = params.args?.where?.id || params.args?.where?.firebaseId;
      if (id) {
        await db.collection('restaurants').doc(id).delete().catch(() => {});
      }
      return;
    }

    if (result && result.id) {
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

      if (result.deliveryFeeTiers) {
        syncData.deliveryFeeTiers = result.deliveryFeeTiers;
      }
      if (result.deliveryFeeFormula) {
        syncData.deliveryFeeFormula = result.deliveryFeeFormula;
      }

      await db.collection('restaurants').doc(docId).set(syncData, { merge: true }).catch(() => {});
    }
  }

  private async syncUserToFirestore(db: any, action: string, params: any, result: any) {
    if (action === 'delete' || action === 'deleteMany') {
      const id = params.args?.where?.id || params.args?.where?.firebaseUid;
      if (id) {
        await db.collection('users').doc(id).delete().catch(() => {});
      }
      return;
    }

    if (result && result.id) {
      const docId = result.firebaseUid || result.id;
      const syncData: any = {
        id: docId,
        uid: docId,
        name: result.name,
        email: result.email,
        phone: result.phone || null,
        role: (result.role || 'CUSTOMER').toLowerCase(),
        status: (result.status || 'ACTIVE').toLowerCase(),
        walletBalance: result.walletBalance || 0.0,
        updatedAt: new Date(),
      };
      await db.collection('users').doc(docId).set(syncData, { merge: true }).catch(() => {});
    }
  }

  private async syncDriverProfileToFirestore(db: any, action: string, params: any, result: any) {
    if (action === 'delete' || action === 'deleteMany') {
      const id = params.args?.where?.userId || params.args?.where?.id;
      if (id) {
        await db.collection('driverProfiles').doc(id).delete().catch(() => {});
      }
      return;
    }

    if (result && result.userId) {
      const user = await this.user.findUnique({ where: { id: result.userId } }).catch(() => null);
      const docId = user?.firebaseUid || result.userId;

      const syncData: any = {
        userId: docId,
        isAvailable: result.isAvailable,
        rating: result.rating || 5.0,
        totalTrips: result.totalTrips || 0,
        canDeliver: result.canDeliver,
        canTransport: result.canTransport,
        lastLocation: result.currentLat && result.currentLng ? {
          latitude: result.currentLat,
          longitude: result.currentLng,
        } : null,
        updatedAt: new Date(),
      };
      await db.collection('driverProfiles').doc(docId).set(syncData, { merge: true }).catch(() => {});
    }
  }

  private async syncMenuSectionToFirestore(db: any, action: string, params: any, result: any, preDeleteData: any) {
    let restaurantId = result?.restaurantId;
    let sectionId = result?.firebaseId || result?.id;

    if (action === 'delete' || action === 'deleteMany') {
      restaurantId = preDeleteData?.restaurantId;
      sectionId = preDeleteData?.id;
      if (restaurantId && sectionId) {
        const restaurant = await this.restaurant.findUnique({
          where: { id: restaurantId },
          select: { firebaseId: true }
        }).catch(() => null);
        const firestoreRestaurantId = restaurant?.firebaseId || restaurantId;

        await db.collection('restaurants').doc(firestoreRestaurantId).collection('menuSections').doc(sectionId).delete().catch(() => {});
      }
      return;
    }

    if (result && result.id && restaurantId) {
      const restaurant = await this.restaurant.findUnique({
        where: { id: restaurantId },
        select: { firebaseId: true }
      }).catch(() => null);
      const firestoreRestaurantId = restaurant?.firebaseId || restaurantId;

      const syncData: any = {
        id: sectionId,
        restaurantId: firestoreRestaurantId,
        name: result.name,
        nameAr: result.nameAr || null,
        isActive: result.isActive,
        sortOrder: result.sortOrder ?? 0,
        updatedAt: new Date(),
      };
      await db.collection('restaurants').doc(firestoreRestaurantId).collection('menuSections').doc(sectionId).set(syncData, { merge: true }).catch(() => {});
    }
  }

  private async syncFoodItemToFirestore(db: any, action: string, params: any, result: any, preDeleteData: any) {
    let sectionId = result?.sectionId;
    let itemId = result?.firebaseId || result?.id;

    if (action === 'delete' || action === 'deleteMany') {
      sectionId = preDeleteData?.sectionId;
      itemId = preDeleteData?.id;
      if (sectionId && itemId) {
        const section = await this.menuSection.findUnique({
          where: { id: sectionId },
          select: { 
            restaurantId: true, 
            firebaseId: true,
            restaurant: { select: { firebaseId: true } }
          }
        }).catch(() => null);
        
        const restaurantId = section?.restaurantId;
        const firestoreRestaurantId = section?.restaurant?.firebaseId || restaurantId;
        const firestoreSectionId = section?.firebaseId || sectionId;

        if (firestoreRestaurantId && firestoreSectionId) {
          await db.collection('restaurants').doc(firestoreRestaurantId)
            .collection('menuSections').doc(firestoreSectionId)
            .collection('items').doc(itemId)
            .delete().catch(() => {});
        }
      }
      return;
    }

    if (result && result.id && sectionId) {
      const section = await this.menuSection.findUnique({
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

      const variants = await this.foodItemVariant.findMany({
        where: { foodItemId: result.id }
      }).catch(() => []);

      const syncData: any = {
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
        variants: variants.map(v => ({
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

      await db.collection('restaurants').doc(firestoreRestaurantId)
        .collection('menuSections').doc(firestoreSectionId)
        .collection('items').doc(itemId)
        .set(syncData, { merge: true }).catch(() => {});
    }
  }

  private async syncFoodItemVariantToFirestore(db: any, action: string, params: any, result: any, preDeleteData: any) {
    let foodItemId = result?.foodItemId;
    if (action === 'delete' || action === 'deleteMany') {
      foodItemId = preDeleteData?.foodItemId;
    }
    
    // Support createMany / updateMany operations where foodItemId is inside the array/object of args.data
    if (!foodItemId && params?.args?.data) {
      if (Array.isArray(params.args.data)) {
        foodItemId = params.args.data[0]?.foodItemId;
      } else {
        foodItemId = params.args.data?.foodItemId;
      }
    }
    
    if (foodItemId) {
      const foodItem = await this.foodItem.findUnique({
        where: { id: foodItemId }
      });
      if (foodItem) {
        await this.syncFoodItemToFirestore(db, 'update', { model: 'FoodItem', action: 'update', args: { where: { id: foodItemId } } }, foodItem, null);
      }
    }
  }

  async syncFoodItemDirect(itemId: string) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) return;
    const db = admin.firestore();
    if (!db) return;

    const foodItem = await this.foodItem.findUnique({
      where: { id: itemId }
    });
    if (foodItem) {
      await this.syncFoodItemToFirestore(db, 'update', { model: 'FoodItem', action: 'update', args: { where: { id: itemId } } }, foodItem, null);
    }
  }

  /**
   * Soft-delete helper: sets deletedAt on a record.
   */
  async softDelete(model: string, id: string) {
    return (this as any)[model].update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Cleanup: hard-delete soft-deleted records older than `days` days.
   */
  async cleanupSoftDeleted(model: string, days: number = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return (this as any)[model].deleteMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
      },
    });
  }

  private async syncSystemConfigToFirestore(db: any, action: string, params: any, result: any) {
    if (action === 'delete' || action === 'deleteMany') {
      return;
    }
    if (result && result.defaultAppCommissionRate !== undefined) {
      await db.collection('sys_settings').doc('app_settings').set({
        platformCommission: parseFloat(result.defaultAppCommissionRate.toString()),
      }, { merge: true }).catch((err: any) => {
        this.logger.warn(`Failed to sync SystemConfig to Firestore: ${err.message}`);
      });
      this.logger.log(`Synced SystemConfig to Firestore platformCommission: ${result.defaultAppCommissionRate}`);
    }
  }
}
