import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, ApplicationStatus } from '@prisma/client';

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

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

      // 3. Log the action
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
}
