import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountStatus, Role } from '@prisma/client';

@Injectable()
export class FirebaseSyncService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseSyncService.name);

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting Initial Firebase Synchronization...');
    try {
      await this.syncAllData();
      this.setupRealtimeListeners();
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Sync:', error);
    }
  }

  /**
   * One-time sync of all existing data from Firebase to PostgreSQL
   */
  private async syncAllData() {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) {
      this.logger.warn('Firestore not initialized, skipping sync.');
      return;
    }

    // 1. Sync Users / Admins
    try {
      const usersSnapshot = await firestore.collection('users').get();
      let syncedUsers = 0;
      for (const doc of usersSnapshot.docs) {
        await this.syncUserToPostgres(doc.id, doc.data());
        syncedUsers++;
      }
      this.logger.log(`Successfully verified and synced ${syncedUsers} users/admins from Firebase.`);
    } catch (err) {
      this.logger.error('Error syncing old users data:', err);
    }

    // 2. Sync Vendor Applications (Optional - but ensures consistency)
    try {
      const vendorsSnapshot = await firestore.collection('vendor_applications').get();
      let syncedVendors = 0;
      for (const doc of vendorsSnapshot.docs) {
        // You can add logic to ensure approved vendors exist as Restaurants
        // But mainly we rely on the Admin Panel Approve endpoint to do this.
        syncedVendors++;
      }
      this.logger.log(`Verified ${syncedVendors} vendor applications in Firebase.`);
    } catch (err) {
      this.logger.error('Error verifying vendor applications:', err);
    }

    // 3. Sync Restaurants
    try {
      const restaurantsSnapshot = await firestore.collection('restaurants').get();
      let syncedRestaurants = 0;
      for (const doc of restaurantsSnapshot.docs) {
        await this.syncRestaurantToPostgres(doc.id, doc.data());
        syncedRestaurants++;
      }
      this.logger.log(`Successfully verified and synced ${syncedRestaurants} restaurants from Firebase.`);
    } catch (err) {
      this.logger.error('Error syncing old restaurants data:', err);
    }
  }

  /**
   * Set up real-time listeners for instant synchronization
   */
  private setupRealtimeListeners() {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) return;

    this.logger.log('Setting up real-time Firestore listeners...');

    // Listen to changes in the 'users' collection
    firestore.collection('users').onSnapshot(
      async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const data = change.doc.data();
          const uid = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            await this.syncUserToPostgres(uid, data);
            this.logger.log(`Real-time Sync: User ${uid} updated from Firebase`);
          } else if (change.type === 'removed') {
            await this.prisma.user.updateMany({
              where: { firebaseUid: uid },
              data: { status: AccountStatus.BANNED, deletedAt: new Date() },
            });
            this.logger.log(`Real-time Sync: User ${uid} marked as deleted/banned`);
          }
        }
      },
      (error) => {
        this.logger.error('Real-time listener error (users):', error);
      }
    );

    // Listen to changes in the 'restaurants' collection
    firestore.collection('restaurants').onSnapshot(
      async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const data = change.doc.data();
          const id = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            await this.syncRestaurantToPostgres(id, data);
          } else if (change.type === 'removed') {
            await this.prisma.restaurant.updateMany({
              where: { firebaseId: id },
              data: { status: AccountStatus.INACTIVE, isActive: false },
            });
            this.logger.log(`Real-time Sync: Restaurant ${id} marked as inactive/deleted`);
          }
        }
      },
      (error) => {
        this.logger.error('Real-time listener error (restaurants):', error);
      }
    );
  }

  /**
   * Helper to insert or update user in Postgres based on Firebase data
   */
  private async syncUserToPostgres(uid: string, data: any) {
    if (!data.email) return;

    // Map Firebase roles to PostgreSQL roles
    let role: Role = Role.CUSTOMER;
    if (data.role === 'admin' || data.role === 'ADMIN') role = Role.ADMIN;
    else if (data.role === 'superadmin' || data.role === 'SUPERADMIN') role = Role.SUPERADMIN as Role;
    else if (data.role === 'vendor' || data.role === 'VENDOR') role = Role.VENDOR;
    else if (data.role === 'driver' || data.role === 'DRIVER') role = Role.DRIVER;

    let fcmTokens: string[] = [];
    if (data.fcmTokens) {
      if (Array.isArray(data.fcmTokens)) {
        fcmTokens = data.fcmTokens.filter((t: any) => typeof t === 'string');
      } else if (typeof data.fcmTokens === 'string') {
        fcmTokens = [data.fcmTokens];
      }
    }

    let status: AccountStatus | undefined = undefined;
    if (data.status) {
      const s = data.status.toUpperCase();
      if (Object.values(AccountStatus).includes(s as any)) {
        status = s as AccountStatus;
      }
    }

    try {
      // Find by email or firebaseUid
      const existingUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            { firebaseUid: uid },
            { email: data.email },
          ]
        }
      });

      if (!existingUser) {
        // Create new user in Postgres
        await this.prisma.user.create({
          data: {
            firebaseUid: uid,
            email: data.email,
            name: data.displayName || data.name || data.email.split('@')[0],
            role: role,
            status: status || AccountStatus.ACTIVE,
            emailVerified: true,
            authProvider: 'firebase',
            phone: data.phone || data.phoneNumber || null,
            fcmTokens: fcmTokens.length > 0 ? fcmTokens : undefined,
          }
        });
      } else {
        // Check if the firebaseUid is already taken by another user
        if (uid !== existingUser.firebaseUid) {
          const uidTaken = await this.prisma.user.findFirst({
            where: { firebaseUid: uid, id: { not: existingUser.id } }
          });
          if (uidTaken) {
            this.logger.warn(`Firebase UID ${uid} is already assigned to user ${uidTaken.email}. Skipping update for ${data.email}.`);
            return;
          }
        }

        // Update existing user with Firebase UID and Role (if Firebase has a higher privilege)
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firebaseUid: uid,
            // Only update role if it's admin/superadmin to avoid demoting someone accidentally
            role: (role === Role.ADMIN || (role as any) === 'SUPERADMIN') ? role : existingUser.role,
            status: status,
            name: existingUser.name || data.displayName || data.name,
            phone: existingUser.phone || data.phone || data.phoneNumber,
            fcmTokens: fcmTokens.length > 0 ? fcmTokens : undefined,
          }
        });
      }
    } catch (error) {
      this.logger.error(`Error syncing user ${data.email} to Postgres:`, error);
    }
  }

  /**
   * Helper to insert or update restaurant in Postgres based on Firebase data
   */
  private async syncRestaurantToPostgres(firebaseId: string, data: any) {
    if (!data.ownerId) return;

    try {
      const owner = await this.prisma.user.findFirst({
        where: { firebaseUid: data.ownerId }
      });
      if (!owner) {
        this.logger.warn(`Could not sync restaurant ${firebaseId}: Owner user with Firebase UID ${data.ownerId} not found in Postgres.`);
        return;
      }

      let status: AccountStatus = AccountStatus.ACTIVE;
      if (data.status) {
        const s = data.status.toUpperCase();
        if (s === 'ACTIVE') status = AccountStatus.ACTIVE;
        else if (s === 'PENDING') status = AccountStatus.PENDING_VERIFICATION;
        else if (s === 'SUSPENDED') status = AccountStatus.SUSPENDED;
        else if (s === 'INACTIVE') status = AccountStatus.INACTIVE;
        else if (s === 'BANNED') status = AccountStatus.BANNED;
      } else if (data.isActive !== undefined) {
        status = data.isActive ? AccountStatus.ACTIVE : AccountStatus.SUSPENDED;
      }

      const existingRestaurant = await this.prisma.restaurant.findFirst({
        where: { firebaseId: firebaseId }
      });

      if (!existingRestaurant) {
        await this.prisma.restaurant.create({
          data: {
            firebaseId: firebaseId,
            ownerId: owner.id,
            name: data.name || 'New Restaurant',
            nameAr: data.nameAr || null,
            status: status,
            isActive: data.isActive !== undefined ? data.isActive : true,
            isOpen: data.isOpen !== undefined ? data.isOpen : false,
            vendorType: (data.vendorType || 'restaurant').toUpperCase(),
            walletBalance: data.walletBalance || 0.0,
            payoutPhoneNumber: data.phone || '',
            address: data.address || '',
          }
        });
        this.logger.log(`Created restaurant ${data.name} (Firebase: ${firebaseId}) in Postgres`);
      } else {
        await this.prisma.restaurant.update({
          where: { id: existingRestaurant.id },
          data: {
            name: data.name || existingRestaurant.name,
            nameAr: data.nameAr || existingRestaurant.nameAr,
            status: status,
            isActive: data.isActive !== undefined ? data.isActive : existingRestaurant.isActive,
            isOpen: data.isOpen !== undefined ? data.isOpen : existingRestaurant.isOpen,
            walletBalance: data.walletBalance !== undefined ? data.walletBalance : existingRestaurant.walletBalance,
            payoutPhoneNumber: data.phone || existingRestaurant.payoutPhoneNumber,
            address: data.address || existingRestaurant.address,
          }
        });
        this.logger.log(`Updated restaurant ${data.name} (Firebase: ${firebaseId}) in Postgres`);
      }
    } catch (error) {
      this.logger.error(`Error syncing restaurant ${firebaseId} to Postgres:`, error);
    }
  }
}
