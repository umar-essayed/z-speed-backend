import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import {
  ApplicationStatus,
  DeliveryRequestStatus,
  OrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ApplyDriverDto, UpdateLocationDto } from './dto';
import Redis from 'ioredis';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    private readonly notifications: NotificationsService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * Submit driver application with documents & vehicle info.
   */
  async applyDriver(userId: string, dto: ApplyDriverDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Driver profile not found. Register as DRIVER first.');
    }

    // Update application info
    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        nationalId: dto.nationalId,
        nationalIdUrl: dto.nationalIdUrl,
        driverLicenseUrl: dto.driverLicenseUrl,
        payoutPhoneNumber: dto.payoutPhoneNumber,
        applicationStatus: ApplicationStatus.UNDER_REVIEW,
      },
    });

    // Create vehicle if provided
    if (dto.vehicle) {
      await this.prisma.vehicle.upsert({
        where: { driverProfileId: profile.id },
        create: {
          driverProfileId: profile.id,
          type: dto.vehicle.type,
          make: dto.vehicle.make,
          model: dto.vehicle.model,
          year: dto.vehicle.year,
          plateNumber: dto.vehicle.plateNumber,
          color: dto.vehicle.color,
          registrationDocUrl: dto.vehicle.registrationDocUrl,
        },
        update: {
          type: dto.vehicle.type,
          make: dto.vehicle.make,
          model: dto.vehicle.model,
          year: dto.vehicle.year,
          plateNumber: dto.vehicle.plateNumber,
          color: dto.vehicle.color,
          registrationDocUrl: dto.vehicle.registrationDocUrl,
        },
      });
    }

    this.logger.log(`Driver application submitted: ${userId}`);
    return updated;
  }

  /**
   * Update driver's real-time location.
   */
  async updateLocation(userId: string, dto: UpdateLocationDto) {
    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        currentLat: dto.currentLat,
        currentLng: dto.currentLng,
        lastPingAt: new Date(),
      },
    });

    if (dto.currentLng && dto.currentLat) {
      await this.redis.geoadd('drivers:locations', dto.currentLng, dto.currentLat, updated.id);
    }
    return updated;
  }

  /**
   * Toggle driver online/offline status.
   */
  async toggleAvailability(userId: string, isAvailable: boolean) {
    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: { isAvailable },
    });

    if (!isAvailable) {
      await this.redis.zrem('drivers:locations', updated.id);
    }
    return updated;
  }

  /**
   * Get pending delivery requests for the driver.
   */
  async getDeliveryRequests(userId: string) {
    const profile = await this.getProfile(userId);

    return this.prisma.deliveryRequest.findMany({
      where: {
        driverId: profile.id,
        status: DeliveryRequestStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: {
        order: {
          include: {
            restaurant: { select: { name: true, latitude: true, longitude: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Accept a delivery request.
   */
  async acceptRequest(userId: string, requestId: string) {
    const profile = await this.getProfile(userId);

    const request = await this.prisma.deliveryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Delivery request not found');
    if (request.driverId !== profile.id) {
      throw new BadRequestException('This request is not assigned to you');
    }
    if (request.status !== DeliveryRequestStatus.PENDING) {
      throw new BadRequestException('Request is no longer pending');
    }
    if (request.expiresAt < new Date()) {
      throw new BadRequestException('Request has expired');
    }

    // Accept this request
    await this.prisma.deliveryRequest.update({
      where: { id: requestId },
      data: { status: DeliveryRequestStatus.ACCEPTED },
    });

    // Assign driver to order
    await this.prisma.order.update({
      where: { id: request.orderId },
      data: {
        driverId: profile.id,
        status: OrderStatus.IN_PROGRESS,
        driverAssignedAt: new Date(),
      },
    });

    // Cancel other pending requests for same order
    await this.prisma.deliveryRequest.updateMany({
      where: {
        orderId: request.orderId,
        id: { not: requestId },
        status: DeliveryRequestStatus.PENDING,
      },
      data: { status: DeliveryRequestStatus.EXPIRED },
    });

    // Update acceptance stats
    await this.prisma.driverProfile.update({
      where: { id: profile.id },
      data: {
        totalAccepted: { increment: 1 },
      },
    });

    this.logger.log(`Driver ${profile.id} accepted request ${requestId}`);

    // Notify Customer
    const order = await this.prisma.order.findUnique({
      where: { id: request.orderId },
      select: { customerId: true },
    });
    if (order) {
      await this.notifications.notifyCustomer(
        order.customerId,
        'IN_PROGRESS',
        request.orderId,
      );
      this.gateway.emitToCustomer(order.customerId, 'order:assigned', {
        orderId: request.orderId,
        driverId: profile.id,
      });
    }

    return { message: 'Delivery request accepted' };
  }

  /**
   * Reject a delivery request.
   */
  async rejectRequest(userId: string, requestId: string, reason?: string) {
    const profile = await this.getProfile(userId);

    const request = await this.prisma.deliveryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.driverId !== profile.id) {
      throw new NotFoundException('Delivery request not found');
    }

    await this.prisma.deliveryRequest.update({
      where: { id: requestId },
      data: { status: DeliveryRequestStatus.REJECTED },
    });

    // Update rejection stats
    const updated = await this.prisma.driverProfile.update({
      where: { id: profile.id },
      data: {
        totalRejected: { increment: 1 },
      },
    });

    // Recalculate acceptance rate
    const total = updated.totalAccepted + updated.totalRejected;
    const rate = total > 0 ? (updated.totalAccepted / total) * 100 : 100;
    await this.prisma.driverProfile.update({
      where: { id: profile.id },
      data: { acceptanceRate: Math.round(rate * 10) / 10 },
    });

    return { message: 'Delivery request rejected' };
  }

  /**
   * Get driver's delivery history.
   */
  async getMyOrders(
    userId: string,
    filters: { status?: OrderStatus; page?: number; limit?: number },
  ) {
    const profile = await this.getProfile(userId);
    const { status, page = 1, limit = 20 } = filters;

    const where: any = { driverId: profile.id };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          restaurant: { select: { name: true, logoUrl: true } },
          items: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Get driver earnings summary.
   */
  async getEarnings(userId: string) {
    const profile = await this.getProfile(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayEarnings, recentLedger] = await Promise.all([
      this.prisma.ledger.aggregate({
        where: {
          userId,
          type: 'EARNING',
          createdAt: { gte: todayStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.ledger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      walletBalance: user?.walletBalance ?? 0,
      totalEarnings: profile.totalEarnings,
      todayEarnings: todayEarnings._sum.amount ?? 0,
      totalTrips: profile.totalTrips,
      acceptanceRate: profile.acceptanceRate,
      rating: profile.rating,
      recentTransactions: recentLedger,
    };
  }

  /**
   * Find nearby available drivers (used internally by orders).
   */
  async findNearbyDrivers(lat: number, lng: number, radiusKm: number = 10, orderVolume: number = 1) {
    // 1. Get nearby driver IDs from Redis Geospatial Index (sorted by distance ASC)
    // with distance
    const nearbyResults = (await this.redis.georadius(
      'drivers:locations',
      lng,
      lat,
      radiusKm,
      'km',
      'WITHDIST',
      'ASC',
    )) as unknown as [string, string][];

    if (!nearbyResults || nearbyResults.length === 0) {
      return [];
    }

    const nearbyDriverIds = nearbyResults.map(r => r[0]);
    const distancesMap = new Map<string, number>();
    nearbyResults.forEach(r => distancesMap.set(r[0], parseFloat(r[1])));

    // 2. Fetch drivers from DB sequentially
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        id: { in: nearbyDriverIds },
        applicationStatus: ApplicationStatus.APPROVED,
        isAvailable: true,
        lastPingAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }, // Active in last 10 min
      },
      include: { vehicle: true },
    });

    // 3. Filter and score based on location (distance), ratings, acceptance rate, and vehicle
    const scoredDrivers = drivers.map((driver) => {
      const distance = distancesMap.get(driver.id) || 0;
      
      // Distance score: Max 40 points. Closer is better.
      const distanceScore = Math.max(0, 40 * (1 - (distance / Math.max(radiusKm, 1))));
      
      // Rating score: Max 30 points. (e.g. 5.0 -> 30, 4.0 -> 24)
      const ratingScore = (driver.rating / 5) * 30;
      
      // Acceptance Rate score: Max 20 points.
      const acceptanceScore = (driver.acceptanceRate / 100) * 20;
      
      // Vehicle score: Max 10 points. Determine suitability based on order size.
      let vehicleScore = 10;
      const vType = driver.vehicle?.type?.toLowerCase();
      if (orderVolume > 5 && (vType === 'motorcycle' || vType === 'bicycle')) {
        vehicleScore = 2; // Penalize motorcycle/bicycle for large orders
      } else if (orderVolume <= 2 && (vType === 'car' || vType === 'van')) {
        vehicleScore = 5; // Slight penalty for using a car for tiny orders
      }

      const totalScore = distanceScore + ratingScore + acceptanceScore + vehicleScore;
      
      return { driver, totalScore, distance };
    });

    // Sort by score DESC
    scoredDrivers.sort((a, b) => b.totalScore - a.totalScore);

    return scoredDrivers.map(sd => ({ driver: sd.driver, distance: sd.distance })).slice(0, 10);
  }

  // =============================================
  // HELPERS
  // =============================================

  private async getProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');
    return profile;
  }
}
