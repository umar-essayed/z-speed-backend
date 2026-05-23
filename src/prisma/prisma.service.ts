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
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Prisma connected to database');
      
      // Register global bidirectional sync middleware
      this.registerFirestoreSyncMiddleware();
    } catch (error) {
      this.logger.error('❌ Prisma connection failed:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 Prisma disconnected from database');
  }

  /**
   * Register global Prisma middleware to auto-sync modifications back to Firestore
   */
  private registerFirestoreSyncMiddleware() {
    const admin = require('firebase-admin');

    (this as any).$use(async (params: any, next: any) => {
      const result = await next(params);

      // Perform Firestore synchronization in background post-commit
      try {
        if (!admin.apps.length) return result;
        const db = admin.firestore();
        if (!db) return result;

        const model = params.model;
        const action = params.action;

        if (model === 'Restaurant') {
          await this.syncRestaurantToFirestore(db, action, params, result);
        } else if (model === 'User') {
          await this.syncUserToFirestore(db, action, params, result);
        } else if (model === 'DriverProfile') {
          await this.syncDriverProfileToFirestore(db, action, params, result);
        }
      } catch (err) {
        this.logger.warn(`Prisma global Firestore sync failed for model ${params.model}: ${err.message}`);
      }

      return result;
    });
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
}
