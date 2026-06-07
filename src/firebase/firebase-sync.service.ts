import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountStatus, Role } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class FirebaseSyncService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseSyncService.name);

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing Firebase real-time listeners...');
    try {
      this.setupRealtimeListeners();
      // Run historical sync/reconciliation once asynchronously on startup
      setImmediate(async () => {
        try {
          this.logger.log('Running startup sync/reconciliation...');
          await this.syncAllData();
          this.logger.log('Startup sync/reconciliation completed.');
        } catch (err) {
          this.logger.error('Startup sync/reconciliation failed:', err);
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize Firebase real-time listeners:', error);
    }
  }

  /**
   * Sync all existing data and reconcile deletions from Firebase to PostgreSQL (scheduled every 12 hours at 3:00 AM and 3:00 PM)
   */
  @Cron('0 3,15 * * *')
  async syncAllData() {
    const firestore = this.firebaseAdmin.getFirestore();
    const auth = this.firebaseAdmin.getAuth();
    if (!firestore || !auth) {
      this.logger.warn('Firestore or Auth not initialized, skipping sync.');
      return;
    }

    const activeFirebaseUids = new Set<string>();

    // 1. Sync Users / Admins from Firestore
    try {
      const usersSnapshot = await firestore.collection('users').get();
      let syncedUsers = 0;
      for (const doc of usersSnapshot.docs) {
        await this.syncUserToPostgres(doc.id, doc.data());
        activeFirebaseUids.add(doc.id);
        syncedUsers++;
      }
      this.logger.log(`Successfully verified and synced ${syncedUsers} users/admins from Firebase Firestore.`);
    } catch (err) {
      this.logger.error('Error syncing old users data:', err);
    }

    // 2. Fetch all Firebase Auth Users to ensure we catch UIDs from Auth
    try {
      let pageToken: string | undefined = undefined;
      do {
        const listUsersResult: any = await auth.listUsers(1000, pageToken);
        for (const userRecord of listUsersResult.users) {
          activeFirebaseUids.add(userRecord.uid);
        }
        pageToken = listUsersResult.pageToken;
      } while (pageToken);
      this.logger.log(`Collected active Firebase Auth users. Total unique Firebase UIDs: ${activeFirebaseUids.size}`);
    } catch (err) {
      this.logger.error('Error fetching Firebase Auth users list:', err);
    }

    // 3. Reconcile Deletions (Postgres -> Firebase check)
    try {
      const pgActiveUsers = await this.prisma.user.findMany({
        where: {
          firebaseUid: { not: null },
          deletedAt: null,
        },
      });

      let softDeletedCount = 0;
      for (const user of pgActiveUsers) {
        if (user.firebaseUid && !activeFirebaseUids.has(user.firebaseUid)) {
          this.logger.log(`Reconciliation Sync: User ${user.name} (${user.email}) with firebaseUid ${user.firebaseUid} is no longer in Firebase. Soft-deleting/banning in Postgres.`);
          
          await this.prisma.runWithBypassSync(async () => {
            await this.prisma.user.update({
              where: { id: user.id },
              data: {
                status: AccountStatus.BANNED,
                deletedAt: new Date(),
              },
            });
          });
          softDeletedCount++;
        }
      }
      if (softDeletedCount > 0) {
        this.logger.log(`Reconciliation Sync: Soft-deleted/banned ${softDeletedCount} users who were deleted from Firebase.`);
      }
    } catch (err) {
      this.logger.error('Error during deletion reconciliation:', err);
    }

    // 4. Sync Restaurants
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
    let isUsersInitial = true;
    firestore.collection('users').onSnapshot(
      async (snapshot) => {
        const changes = snapshot.docChanges();
        if (isUsersInitial) {
          isUsersInitial = false;
          this.logger.log(`[Realtime Listener] Initial snapshot for users loaded (${changes.length} docs). Skipping historical sync on startup.`);
          return;
        }
        for (const change of changes) {
          const data = change.doc.data();
          const uid = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            await this.prisma.runWithBypassSync(async () => {
              await this.syncUserToPostgres(uid, data);
            });
            this.logger.log(`Real-time Sync: User ${uid} updated from Firebase`);
          } else if (change.type === 'removed') {
            await this.prisma.runWithBypassSync(async () => {
              await this.prisma.user.updateMany({
                where: { firebaseUid: uid },
                data: { status: AccountStatus.BANNED, deletedAt: new Date() },
              });
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
    let isRestaurantsInitial = true;
    firestore.collection('restaurants').onSnapshot(
      async (snapshot) => {
        const changes = snapshot.docChanges();
        if (isRestaurantsInitial) {
          isRestaurantsInitial = false;
          this.logger.log(`[Realtime Listener] Initial snapshot for restaurants loaded (${changes.length} docs). Skipping historical sync on startup.`);
          return;
        }
        for (const change of changes) {
          const data = change.doc.data();
          const id = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            await this.prisma.runWithBypassSync(async () => {
              await this.syncRestaurantToPostgres(id, data);
            });
          } else if (change.type === 'removed') {
            await this.prisma.runWithBypassSync(async () => {
              await this.prisma.restaurant.updateMany({
                where: { firebaseId: id },
                data: { status: AccountStatus.INACTIVE, isActive: false },
              });
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

    // Map Firebase roles to PostgreSQL roles (if role is explicitly specified in Firebase doc)
    let role: Role | undefined = undefined;
    if (data.role) {
      const r = data.role.toString().toLowerCase();
      if (r === 'admin') role = Role.ADMIN;
      else if (r === 'superadmin') role = Role.SUPERADMIN;
      else if (r === 'vendor') role = Role.VENDOR;
      else if (r === 'driver') role = Role.DRIVER;
      else if (r === 'customer') role = Role.CUSTOMER;
    }

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
            role: role || Role.CUSTOMER,
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

        // Update existing user with Firebase UID and Role (restores/aligns role properly, like DRIVER/VENDOR)
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firebaseUid: uid,
            role: role !== undefined ? role : undefined,
            status: status,
            name: existingUser.name || data.displayName || data.name,
            phone: existingUser.phone || data.phone || data.phoneNumber,
            fcmTokens: fcmTokens.length > 0 ? fcmTokens : undefined,
            // If the user was soft-deleted but is still active in Firebase, restore them on login/update
            deletedAt: null,
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
            logoUrl: data.logoUrl || data.image || data.imageUrl || data.logo || null,
            coverImageUrl: data.coverImageUrl || data.coverImage || data.image || data.imageUrl || null,
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
            logoUrl: data.logoUrl || data.image || data.imageUrl || data.logo || existingRestaurant.logoUrl,
            coverImageUrl: data.coverImageUrl || data.coverImage || data.image || data.imageUrl || existingRestaurant.coverImageUrl,
          }
        });
        this.logger.log(`Updated restaurant ${data.name} (Firebase: ${firebaseId}) in Postgres`);
      }
    } catch (error) {
      this.logger.error(`Error syncing restaurant ${firebaseId} to Postgres:`, error);
    }
  }
}
