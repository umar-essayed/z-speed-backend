import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, ApplicationStatus } from '@prisma/client';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private firebaseAdmin: FirebaseAdminService,
  ) {}

  async submitDriverApplication(userId: string, data: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== Role.DRIVER) {
      throw new BadRequestException('User not found or not a driver');
    }

    return this.prisma.driverProfile.upsert({
      where: { userId },
      update: {
        nationalId: data.nationalId,
        nationalIdUrl: data.nationalIdUrl,
        driverLicenseUrl: data.driverLicenseUrl,
        bankInfo: data.bankInfo,
        applicationStatus: ApplicationStatus.PENDING,
        vehicle: {
          upsert: {
            create: {
              type: data.vehicle?.type || 'car',
              make: data.vehicle?.make,
              model: data.vehicle?.model,
              plateNumber: data.vehicle?.plateNumber,
            },
            update: {
              type: data.vehicle?.type || 'car',
              make: data.vehicle?.make,
              model: data.vehicle?.model,
              plateNumber: data.vehicle?.plateNumber,
            },
          },
        },
      },
      create: {
        userId,
        nationalId: data.nationalId,
        nationalIdUrl: data.nationalIdUrl,
        driverLicenseUrl: data.driverLicenseUrl,
        bankInfo: data.bankInfo,
        applicationStatus: ApplicationStatus.PENDING,
        vehicle: {
          create: {
            type: data.vehicle?.type || 'car',
            make: data.vehicle?.make,
            model: data.vehicle?.model,
            plateNumber: data.vehicle?.plateNumber,
          },
        },
      },
    });
  }

  async submitRestaurantApplication(userId: string, data: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== Role.VENDOR) {
      throw new BadRequestException('User not found or not a vendor');
    }

    return this.prisma.restaurant.create({
      data: {
        ownerId: userId,
        name: data.businessInfo?.restaurantName || 'Unnamed Restaurant',
        nameAr: data.businessInfo?.nameAr,
        description: data.businessInfo?.description,
        logoUrl: data.branding?.logoUrl,
        coverImageUrl: data.branding?.coverUrl,
        address: data.locationInfo?.address,
        city: data.locationInfo?.city,
        latitude: data.locationInfo?.latitude,
        longitude: data.locationInfo?.longitude,
        workingHours: data.locationInfo?.operatingHours,
        bankInfo: data.bankInfo,
        documentUrls: data.documentUrls,
        vendorType: data.vendorType || 'food',
      },
    });
  }

  async approveApplication(targetUserId: string, reviewerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { driverProfile: true },
    });

    if (!user) throw new BadRequestException('User not found');

    return this.prisma.$transaction(async (tx) => {
      // 1. Update user status
      await tx.user.update({
        where: { id: targetUserId },
        data: { status: 'ACTIVE' },
      });

      // 2. Update specific profile status
      if (user.role === Role.DRIVER) {
        await tx.driverProfile.update({
          where: { userId: targetUserId },
          data: { applicationStatus: ApplicationStatus.APPROVED },
        });
      } else if (user.role === Role.VENDOR) {
        await tx.restaurant.updateMany({
          where: { ownerId: targetUserId },
          data: { status: 'ACTIVE', isActive: true },
        });
      }

      // 3. Sync to Firebase
      await this.syncToFirebase(targetUserId);

      // 4. Log the action
      await tx.auditLog.create({
        data: {
          userId: reviewerId,
          action: 'APPROVE_ONBOARDING',
          targetTable: 'users',
          targetId: targetUserId,
        },
      });

      return { success: true, message: 'Application approved' };
    });
  }

  async rejectApplication(targetUserId: string, reviewerId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { status: 'INACTIVE' },
      });

      const user = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!user) throw new BadRequestException('User not found');

      if (user.role === Role.DRIVER) {
        await tx.driverProfile.update({
          where: { userId: targetUserId },
          data: {
            applicationStatus: ApplicationStatus.REJECTED,
            rejectionReason: reason,
          },
        });
      } else if (user.role === Role.VENDOR) {
        await tx.restaurant.updateMany({
          where: { ownerId: targetUserId },
          data: { status: 'BANNED' }, // Or a REJECTED status if we add it
        });
      }

      await tx.auditLog.create({
        data: {
          userId: reviewerId,
          action: 'REJECT_ONBOARDING',
          targetTable: 'users',
          targetId: targetUserId,
          newData: { reason },
        },
      });

      return { success: true, message: 'Application rejected' };
    });
  }

  private async syncToFirebase(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { ownedRestaurants: true },
      });

      if (!user) return;

      const auth = this.firebaseAdmin.getAuth();
      const firestore = this.firebaseAdmin.getFirestore();
      if (!auth || !firestore) return;

      // 1. Sync User to Firebase Auth
      let firebaseUid = user.firebaseUid;
      try {
        let fbUser;
        if (firebaseUid) {
          fbUser = await auth.getUser(firebaseUid);
        } else {
          fbUser = await auth.getUserByEmail(user.email);
          firebaseUid = fbUser.uid;
        }

        // Update custom claims
        await auth.setCustomUserClaims(firebaseUid, {
          role: user.role,
          postgresId: user.id,
        });

        if (!user.firebaseUid) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { firebaseUid },
          });
        }
      } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
          // Create user if not exists
          const newFbUser = await auth.createUser({
            email: user.email,
            displayName: user.name,
            phoneNumber: user.phone || undefined,
            // We don't have the plain text password here usually, 
            // but for new ones they might need to reset or we use a default
          });
          firebaseUid = newFbUser.uid;
          await auth.setCustomUserClaims(firebaseUid, {
            role: user.role,
            postgresId: user.id,
          });
          await this.prisma.user.update({
            where: { id: user.id },
            data: { firebaseUid },
          });
        }
      }

      // 2. Sync Restaurants to Firestore
      for (const restaurant of user.ownedRestaurants) {
        const fbId = restaurant.firebaseId || restaurant.id;
        await firestore.collection('restaurants').doc(fbId).set({
          ownerId: user.id,
          name: restaurant.name,
          nameAr: restaurant.nameAr,
          description: restaurant.description,
          logoUrl: restaurant.logoUrl,
          coverImageUrl: restaurant.coverImageUrl,
          status: restaurant.status,
          isActive: restaurant.isActive,
          isOpen: restaurant.isOpen,
          vendorType: restaurant.vendorType,
          address: restaurant.address,
          city: restaurant.city,
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          updatedAt: new Date(),
        }, { merge: true });

        if (!restaurant.firebaseId) {
          await this.prisma.restaurant.update({
            where: { id: restaurant.id },
            data: { firebaseId: fbId },
          });
        }
      }
    } catch (error) {
      console.error('Firebase sync failed in OnboardingService:', error);
    }
  }
}
