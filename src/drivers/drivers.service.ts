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
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ApplyDriverDto, UpdateLocationDto } from './dto';
import Redis from 'ioredis';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    private readonly notifications: NotificationsService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly firebaseAdmin: FirebaseAdminService,
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
        policeClearanceUrl: dto.policeClearanceUrl,
        facePhotoUrl: dto.facePhotoUrl,
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
          insuranceDocUrl: dto.vehicle.insuranceDocUrl,
          vehiclePhotoUrl: dto.vehicle.vehiclePhotoUrl,
        },
        update: {
          type: dto.vehicle.type,
          make: dto.vehicle.make,
          model: dto.vehicle.model,
          year: dto.vehicle.year,
          plateNumber: dto.vehicle.plateNumber,
          color: dto.vehicle.color,
          registrationDocUrl: dto.vehicle.registrationDocUrl,
          insuranceDocUrl: dto.vehicle.insuranceDocUrl,
          vehiclePhotoUrl: dto.vehicle.vehiclePhotoUrl,
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
      
      // Sync to Firebase for Vendor Dashboard
      const firestore = this.firebaseAdmin.getFirestore();
      if (firestore) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (user && user.firebaseUid) {
          await firestore.collection('driverProfiles').doc(user.firebaseUid).set({
            latitude: dto.currentLat,
            longitude: dto.currentLng,
            lastPingAt: new Date(),
            online: updated.isAvailable,
          }, { merge: true });
        }
      }
    }
    return updated;
  }

  /**
   * Update driver profile fields.
   */
  async updateProfile(userId: string, data: any) {
    // If wallet balance is being updated, we update the User model
    if (data.walletBalance !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { walletBalance: data.walletBalance },
      });
      delete data.walletBalance;
    }

    if (Object.keys(data).length === 0) return { message: 'User wallet updated' };

    return this.prisma.driverProfile.update({
      where: { userId },
      data,
    });
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

    // Sync availability to Firebase
    const firestore = this.firebaseAdmin.getFirestore();
    if (firestore) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.firebaseUid) {
        await firestore.collection('driverProfiles').doc(user.firebaseUid).update({
          online: isAvailable,
          updatedAt: new Date(),
        });
      }
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
            restaurant: { select: { name: true, logoUrl: true, latitude: true, longitude: true } },
            customer: { select: { name: true } },
            items: { include: { foodItem: { select: { name: true } } } },
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

    // Notify Customer & Vendor (Async)
    const order = await this.prisma.order.findUnique({
      where: { id: request.orderId },
      select: { customerId: true, restaurantId: true },
    });
    if (order) {
      this.notifications.notifyCustomer(
        order.customerId,
        'IN_PROGRESS',
        request.orderId,
      ).catch(err => this.logger.error(`Failed to notify customer for order ${request.orderId}:`, err.stack));
      
      this.gateway.emitToCustomer(order.customerId, 'order:assigned', {
        orderId: request.orderId,
        driverId: profile.id,
      });

      this.gateway.emitToVendor(order.restaurantId, 'order:driver_assigned', {
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

  async getActiveOrders(userId: string) {
    const profile = await this.getProfile(userId);
    return this.prisma.order.findMany({
      where: {
        driverId: profile.id,
        status: {
          in: [
            OrderStatus.CONFIRMED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.READY_FOR_PICKUP,
            OrderStatus.PICKED_UP,
            OrderStatus.IN_TRANSIT,
            OrderStatus.IN_PROGRESS,
            OrderStatus.OUT_FOR_DELIVERY,
          ],
        },
      },
      include: {
        restaurant: true,
        customer: true,
        items: { include: { foodItem: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrderHistory(userId: string) {
    const profile = await this.getProfile(userId);
    return this.prisma.order.findMany({
      where: {
        driverId: profile.id,
        status: {
          in: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
        },
      },
      include: {
        restaurant: true,
        customer: true,
        items: { include: { foodItem: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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

  /**
   * Get all currently available drivers (for vendors/admin).
   */
  /**
   * Get all currently available drivers (for vendors/admin).
   * Now supports optional lat/lng for distance calculation and radius filtering.
   */
  async getAvailableDrivers(lat?: number, lng?: number, radiusKm: number = 30) {
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        isAvailable: true,
        applicationStatus: ApplicationStatus.APPROVED,
        currentLat: { not: null },
        currentLng: { not: null },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            profileImage: true,
            email: true,
          },
        },
        vehicle: {
          select: {
            type: true,
            make: true,
            model: true,
            year: true,
            plateNumber: true,
            color: true,
          }
        },
        deliveries: {
          where: {
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] }
          },
          select: { id: true }
        }
      },
    });

    const mapped = drivers.map(d => {
      let distance = null;
      if (lat && lng && d.currentLat && d.currentLng) {
        distance = this.calculateDistance(lat, lng, d.currentLat, d.currentLng);
      }

      return {
        id: d.id,
        currentLat: d.currentLat,
        currentLng: d.currentLng,
        distance, // In KM
        rating: d.rating,
        totalTrips: d.totalTrips,
        isAvailable: d.isAvailable,
        isBusy: d.deliveries.length > 0,
        user: d.user,
        vehicle: d.vehicle,
        updatedAt: d.updatedAt
      };
    });

    // Filter by radius and sort by distance
    return mapped
      .filter(d => (d.distance === null || d.distance <= radiusKm))
      .sort((a, b) => (a.distance || 999) - (b.distance || 999));
  }

  public calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // =============================================
  // HELPERS
  // =============================================

  /**
   * Ensure a driver profile exists for the user.
   * Creates one if it doesn't exist.
   */
  async ensureProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== Role.DRIVER) {
      throw new BadRequestException('User is not a DRIVER');
    }

    const profile = await this.prisma.driverProfile.upsert({
      where: { userId },
      create: {
        userId,
        applicationStatus: ApplicationStatus.PENDING,
      },
      update: {}, // Do nothing if already exists
    });

    return profile;
  }

  /**
   * Get full driver profile including vehicle and user data.
   */
  async getDriverProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            profileImage: true,
            walletBalance: true,
          },
        },
        vehicle: true,
      },
    });

    if (!profile) throw new NotFoundException('Driver profile not found');

    // Map to the format expected by Flutter (which might be slightly different than DB)
    return {
      ...profile,
      name: profile.user.name,
      phoneNumber: profile.user.phone,
      walletBalance: profile.user.walletBalance,
      vehicleType: profile.vehicle?.type ?? '',
      vehicleMake: profile.vehicle?.make ?? '',
      vehicleModel: profile.vehicle?.model ?? '',
      licensePlate: profile.vehicle?.plateNumber ?? '',
      licenseNumber: profile.nationalId ?? '', // Using nationalId as placeholder for licenseNumber if needed
      status: profile.isAvailable ? 'online' : 'offline',
    };
  }

  private async getProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');
    return profile;
  }
}
