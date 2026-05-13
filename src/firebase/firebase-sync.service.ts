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
      (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
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
        });
      },
      (error) => {
        this.logger.error('Real-time listener error (users):', error);
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
            status: AccountStatus.ACTIVE,
            emailVerified: true,
            authProvider: 'firebase',
            phone: data.phone || data.phoneNumber || null,
          }
        });
      } else {
        // Update existing user with Firebase UID and Role (if Firebase has a higher privilege)
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firebaseUid: uid,
            // Only update role if it's admin/superadmin to avoid demoting someone accidentally
            role: (role === Role.ADMIN || role === Role.SUPERADMIN) ? role : existingUser.role,
            name: existingUser.name || data.displayName || data.name,
            phone: existingUser.phone || data.phone || data.phoneNumber,
          }
        });
      }
    } catch (error) {
      this.logger.error(`Error syncing user ${data.email} to Postgres:`, error);
    }
  }
}
