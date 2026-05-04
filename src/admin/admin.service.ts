import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getAllUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingApplications() {
    const drivers = await this.prisma.driverProfile.findMany({
      where: { applicationStatus: 'PENDING' },
      include: { user: true },
    });
    
    const restaurants = await this.prisma.restaurant.findMany({
      where: { status: 'PENDING_VERIFICATION' },
      include: { owner: true },
    });

    return { drivers, restaurants };
  }

  async getSettings() {
    let config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
    });
    if (!config) {
      config = await this.prisma.systemConfig.create({ data: { id: 'default' } });
    }
    return config;
  }

  async getAuditLogs() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    });
  }
}
