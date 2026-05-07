import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationStatus } from '@prisma/client';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByUserId(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: true,
        vehicle: true,
      },
    });

    if (!profile) {
      return [];
    }

    // Map DriverProfile to Application structure for Flutter app
    const application = {
      id: profile.id,
      userId: profile.userId,
      applicationType: 'driver',
      status: profile.applicationStatus,
      formData: {
        personalInfo: {
          fullName: profile.user.name,
          email: profile.user.email,
          phone: profile.user.phone,
          dateOfBirth: profile.dateOfBirth?.toISOString(),
          nationalId: profile.nationalId,
        },
        vehicleInfo: profile.vehicle ? {
          vehicleType: profile.vehicle.type,
          make: profile.vehicle.make,
          model: profile.vehicle.model,
          year: profile.vehicle.year,
          plateNumber: profile.vehicle.plateNumber,
          color: profile.vehicle.color,
        } : {},
        documents: {
          nationalIdUrl: profile.nationalIdUrl,
          driverLicenseUrl: profile.driverLicenseUrl,
        },
      },
      documentUrls: [
        profile.nationalIdUrl,
        profile.driverLicenseUrl,
      ].filter(Boolean),
      sectionStatuses: {
        personalInfo: 'approved',
        vehicleInfo: profile.vehicle ? 'approved' : 'pending',
        documents: 'approved',
      },
      submittedAt: profile.createdAt.toISOString(),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };

    return [application];
  }

  async getById(id: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: {
        user: true,
        vehicle: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Application not found');
    }

    return {
      id: profile.id,
      userId: profile.userId,
      applicationType: 'driver',
      status: profile.applicationStatus,
      formData: {
        personalInfo: {
          fullName: profile.user.name,
          email: profile.user.email,
          phone: profile.user.phone,
          dateOfBirth: profile.dateOfBirth?.toISOString(),
          nationalId: profile.nationalId,
        },
        vehicleInfo: profile.vehicle ? {
          vehicleType: profile.vehicle.type,
          make: profile.vehicle.make,
          model: profile.vehicle.model,
          year: profile.vehicle.year,
          plateNumber: profile.vehicle.plateNumber,
          color: profile.vehicle.color,
        } : {},
        documents: {
          nationalIdUrl: profile.nationalIdUrl,
          driverLicenseUrl: profile.driverLicenseUrl,
        },
      },
      documentUrls: [
        profile.nationalIdUrl,
        profile.driverLicenseUrl,
      ].filter(Boolean),
      submittedAt: profile.createdAt.toISOString(),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
