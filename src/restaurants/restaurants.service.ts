import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRestaurantDto,
  UpdateRestaurantDto,
  DeliverySettingsDto,
} from './dto';

@Injectable()
export class RestaurantsService {
  private readonly logger = new Logger(RestaurantsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new restaurant (VENDOR). Status defaults to PENDING_VERIFICATION.
   */
  async create(ownerId: string, dto: CreateRestaurantDto) {
    const restaurant = await this.prisma.restaurant.create({
      data: {
        ownerId,
        name: dto.name,
        nameAr: dto.nameAr,
        latitude: dto.latitude,
        longitude: dto.longitude,
        address: dto.address,
        city: dto.city,
        documentUrls: dto.documentUrls as any,
        vendorType: dto.vendorType,
        payoutPhoneNumber: dto.payoutPhoneNumber,
        bankInfo: dto.bankInfo as any,
        status: AccountStatus.PENDING_VERIFICATION,
      },
    });

    this.logger.log(`Restaurant created: ${restaurant.id} by vendor ${ownerId}`);
    return restaurant;
  }

  /**
   * Find all restaurants with optional filters (public endpoint).
   */
  /**
   * Find all restaurants with optional filters & ranking/geofencing.
   */
  async findAll(filters: {
    userId?: string;
    city?: string;
    vendorType?: string;
    search?: string;
    isOpen?: boolean;
    minRating?: number;
    maxDeliveryTime?: number;
    cuisineIds?: string[];
    categoryIds?: string[];
    sortBy?: 'rating' | 'distance' | 'deliveryTime' | 'newest';
    page?: number;
    limit?: number;
  }) {
    const {
      userId,
      city,
      vendorType,
      search,
      isOpen,
      minRating,
      maxDeliveryTime,
      cuisineIds,
      categoryIds,
      sortBy,
      page = 1,
      limit = 20,
    } = filters;

    const where: any = {
      status: AccountStatus.ACTIVE,
      isActive: true,
    };

    if (city) where.city = city;
    if (vendorType) where.vendorType = vendorType;
    if (isOpen !== undefined) where.isOpen = isOpen;
    if (minRating) where.rating = { gte: Number(minRating) };
    if (maxDeliveryTime) where.deliveryTimeMax = { lte: Number(maxDeliveryTime) };
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameAr: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (cuisineIds && cuisineIds.length > 0) {
      where.cuisineTypes = {
        some: { cuisineTypeId: { in: cuisineIds } },
      };
    }

    if (categoryIds && categoryIds.length > 0) {
      where.categories = {
        some: { categoryId: { in: categoryIds } },
      };
    }

    // Query active restaurants
    const restaurants = await this.prisma.restaurant.findMany({
      where,
      include: {
        cuisineTypes: { include: { cuisineType: true } },
        categories: { include: { category: true } },
        menuSections: true,
      },
    });

    let userAddress: any = null;
    let preferredSections: string[] = [];
    let userReviews: any[] = [];
    let areaTrend: Record<string, number> = {};

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { addresses: true },
      });

      if (user && user.addresses.length > 0) {
        userAddress = user.addresses.find((a) => a.isDefault) || user.addresses[0];
      }

      // Add smart ranking context if needed
      if (sortBy === undefined) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          const userOrders = await this.prisma.order.findMany({
            where: { customerId: userId, createdAt: { gte: thirtyDaysAgo } },
            include: { items: { include: { foodItem: true } } },
          });

          const sectionOrderCount: Record<string, Set<string>> = {};
          for (const o of userOrders) {
            for (const item of o.items) {
              if (item.foodItem && item.foodItem.sectionId) {
                if (!sectionOrderCount[item.foodItem.sectionId]) {
                  sectionOrderCount[item.foodItem.sectionId] = new Set();
                }
                sectionOrderCount[item.foodItem.sectionId].add(o.id);
              }
            }
          }

          for (const sectionId in sectionOrderCount) {
            if (sectionOrderCount[sectionId].size > 2) {
              preferredSections.push(sectionId);
            }
          }

          userReviews = await this.prisma.review.findMany({
            where: { customerId: userId },
          });

          const trendCity = userAddress?.city || city;
          if (trendCity) {
            const areaOrders = await this.prisma.order.findMany({
              where: {
                restaurant: { city: trendCity },
                createdAt: { gte: thirtyDaysAgo },
              },
              select: { restaurantId: true },
            });

            for (const o of areaOrders) {
              areaTrend[o.restaurantId] = (areaTrend[o.restaurantId] || 0) + 1;
            }
          }
      }
    }

    function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
      const R = 6371; // km
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const processedRestaurants = [];

    for (const r of restaurants) {
      let distance = 0;
      if (userAddress && r.latitude && r.longitude) {
        distance = getDistance(
          userAddress.latitude,
          userAddress.longitude,
          r.latitude,
          r.longitude,
        );
        const radius = r.deliveryRadiusKm || 10.0;
        if (distance > radius) {
          continue;
        }
      }

      let score = 0;
      if (sortBy === undefined) {
          // Smart Ranking Score
          const hasPreferredSection = r.menuSections?.some((sec) =>
            preferredSections.includes(sec.id),
          );
          if (hasPreferredSection) score += 50;

          const reviewForRest = userReviews.find((rev) => rev.restaurantId === r.id);
          if (reviewForRest && reviewForRest.restaurantRating >= 4.0) {
            score += 30;
          } else if (reviewForRest) {
            score += reviewForRest.restaurantRating * 5;
          }

          if (areaTrend[r.id]) {
            score += areaTrend[r.id] * 2;
          }
          score += (r.rating || 0) * 2;
      }

      processedRestaurants.push({ ...r, score, distance });
    }

    // Apply Sorting
    if (sortBy === 'rating') {
      processedRestaurants.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === 'distance') {
      processedRestaurants.sort((a, b) => a.distance - b.distance);
    } else if (sortBy === 'deliveryTime') {
      processedRestaurants.sort((a, b) => (a.deliveryTimeMax || 0) - (b.deliveryTimeMax || 0));
    } else if (sortBy === 'newest') {
      processedRestaurants.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else {
      // Default to Smart Ranking Score
      processedRestaurants.sort((a, b) => b.score - a.score);
    }

    const total = processedRestaurants.length;
    const startIndex = (Number(page) - 1) * Number(limit);
    const paginatedData = processedRestaurants.slice(startIndex, startIndex + Number(limit));

    return {
      data: paginatedData,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Global search for restaurants and food items.
   */
  async globalSearch(query: string, city?: string) {
    const [restaurants, foodItems] = await Promise.all([
      this.prisma.restaurant.findMany({
        where: {
          status: AccountStatus.ACTIVE,
          isActive: true,
          city: city || undefined,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { nameAr: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 10,
      }),
      this.prisma.foodItem.findMany({
        where: {
          isAvailable: true,
          section: {
            restaurant: {
              status: AccountStatus.ACTIVE,
              isActive: true,
              city: city || undefined,
            },
          },
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          section: {
            include: {
              restaurant: {
                select: { id: true, name: true, logoUrl: true },
              },
            },
          },
        },
        take: 20,
      }),
    ]);

    return {
      restaurants,
      foodItems: foodItems.map((item) => ({
        ...item,
        restaurant: item.section.restaurant,
      })),
    };
  }

  /**
   * Find restaurant by ID (public).
   */
  async findById(id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
      include: {
        menuSections: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              where: { isAvailable: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        cuisineTypes: { include: { cuisineType: true } },
        categories: { include: { category: true } },
      },
    });

    return restaurant;
  }

  async getVendorMenu(id: string, ownerId: string) {
    const restaurant = await this.verifyOwnership(id, ownerId);

    return this.prisma.menuSection.findMany({
      where: { restaurantId: restaurant.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Find restaurants owned by a vendor.
   */
  async findByOwner(ownerId: string) {
    return this.prisma.restaurant.findMany({
      where: { ownerId },
      include: {
        menuSections: { include: { items: true } },
      },
    });
  }

  /**
   * Update restaurant info — verify ownership.
   */
  async update(id: string, ownerId: string, dto: UpdateRestaurantDto) {
    const restaurant = await this.verifyOwnership(id, ownerId);

    return this.prisma.restaurant.update({
      where: { id: restaurant.id },
      data: dto,
    });
  }

  /**
   * Update delivery settings for a restaurant.
   */
  async updateDeliverySettings(
    id: string,
    ownerId: string,
    dto: DeliverySettingsDto,
  ) {
    await this.verifyOwnership(id, ownerId);

    return this.prisma.restaurant.update({
      where: { id },
      data: {
        deliveryRadiusKm: dto.deliveryRadiusKm,
        deliveryTimeMin: dto.deliveryTimeMin,
        deliveryTimeMax: dto.deliveryTimeMax,
        deliveryFeeMode: dto.deliveryFeeMode,
        deliveryFee: dto.deliveryFee,
        minimumOrder: dto.minimumOrder,
        deliveryFeeTiers: dto.deliveryFeeTiers,
        deliveryFeeFormula: dto.deliveryFeeFormula,
      },
    });
  }

  /**
   * Toggle restaurant open/close status.
   */
  async toggleOpen(id: string, ownerId: string, isOpen: boolean) {
    await this.verifyOwnership(id, ownerId);

    return this.prisma.restaurant.update({
      where: { id },
      data: { isOpen },
    });
  }

  /**
   * Approve a restaurant (ADMIN action).
   */
  async approve(id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    return this.prisma.restaurant.update({
      where: { id },
      data: { status: AccountStatus.ACTIVE, isActive: true },
    });
  }

  /**
   * Reject a restaurant (ADMIN action).
   */
  async reject(id: string, reason?: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    return this.prisma.restaurant.update({
      where: { id },
      data: { status: AccountStatus.INACTIVE, isActive: false },
    });
  }

  /**
   * Suspend a restaurant (ADMIN action).
   */
  async suspend(id: string, reason?: string) {
    return this.prisma.restaurant.update({
      where: { id },
      data: { status: AccountStatus.SUSPENDED, isActive: false, isOpen: false },
    });
  }

  /**
   * Get restaurant stats for vendor dashboard.
   */
  async getStats(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get weekly revenue for the main dashboard chart
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    
    const weeklyOrders = await this.prisma.order.findMany({
      where: {
        restaurantId,
        status: 'DELIVERED',
        createdAt: { gte: sevenDaysAgo }
      },
      select: { createdAt: true, restaurantShare: true }
    });

    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const weeklyRevenue = dayKeys.map((key, i) => {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dayName = dayKeys[d.getDay()];
      const dayRevenue = weeklyOrders
        .filter(o => new Date(o.createdAt).toDateString() === d.toDateString())
        .reduce((sum, o) => sum + o.restaurantShare, 0);
      return { dayKey: dayName, revenue: dayRevenue };
    });

    const [totalOrders, todayOrders, totalEarnings, totalCustomers] = await Promise.all([
      this.prisma.order.count({ where: { restaurantId } }),
      this.prisma.order.count({
        where: { restaurantId, createdAt: { gte: today } },
      }),
      this.prisma.order.aggregate({
        where: { restaurantId, paymentState: 'PAID' },
        _sum: { restaurantShare: true },
      }),
      this.prisma.order.groupBy({
        by: ['customerId'],
        where: { restaurantId },
      }).then(res => res.length)
    ]);

    return {
      totalOrders,
      todayOrders,
      totalEarnings: totalEarnings._sum.restaurantShare || 0,
      totalRevenue: totalEarnings._sum.restaurantShare || 0, // For frontend compatibility
      walletBalance: restaurant.walletBalance,
      rating: restaurant.rating,
      ratingCount: restaurant.ratingCount,
      weeklyRevenue,
      totalCustomers,
      avgPrepTime: 15, // Mocked for now
    };
  }

  async getAnalytics(id: string, ownerId: string, range = 'thisWeek') {
    await this.verifyOwnership(id, ownerId);

    const now = new Date();
    let startDate = new Date();

    switch (range) {
      case 'today': startDate.setHours(0, 0, 0, 0); break;
      case 'thisWeek': startDate.setDate(now.getDate() - 7); break;
      case 'thisMonth': startDate.setMonth(now.getMonth() - 1); break;
      case 'lastMonth': startDate.setMonth(now.getMonth() - 2); break;
      default: startDate.setDate(now.getDate() - 7);
    }

    const orders = await this.prisma.order.findMany({
      where: {
        restaurantId: id,
        createdAt: { gte: startDate },
      },
      include: { items: true },
    });

    const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED');
    const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED');
    const revenue = deliveredOrders.reduce((sum, o) => sum + o.restaurantShare, 0);
    const avgOrder = deliveredOrders.length > 0 ? revenue / deliveredOrders.length : 0;
    
    // Revenue Trend & Order Volume
    const trendMap = new Map();
    orders.forEach(o => {
      const dateKey = o.createdAt.toISOString().split('T')[0];
      const current = trendMap.get(dateKey) || { revenue: 0, orders: 0 };
      if (o.status === 'DELIVERED') current.revenue += o.restaurantShare;
      current.orders += 1;
      trendMap.set(dateKey, current);
    });
    
    const revenueTrend = Array.from(trendMap.values()).map(v => v.revenue);
    const orderVolume = Array.from(trendMap.values()).map(v => v.orders);

    // Peak Hours
    const hours = Array(24).fill(0);
    orders.forEach(o => {
      const hour = new Date(o.createdAt).getHours();
      hours[hour] += 1;
    });

    // Find top item
    const itemMap: any = {};
    orders.forEach(o => {
      o.items.forEach(i => {
        itemMap[i.foodItemId] = (itemMap[i.foodItemId] || 0) + i.quantity;
      });
    });
    
    let topItemId = null;
    let topSales = 0;
    for (const [id, qty] of Object.entries(itemMap)) {
      if ((qty as number) > topSales) {
        topSales = qty as number;
        topItemId = id;
      }
    }
    
    let topItemName = 'N/A';
    if (topItemId) {
      const food = await this.prisma.foodItem.findUnique({ where: { id: topItemId } });
      topItemName = food?.name || 'N/A';
    }

    return {
      revenue: `EGP ${revenue.toFixed(2)}`,
      orders: orders.length.toString(),
      avgOrder: `EGP ${avgOrder.toFixed(2)}`,
      completion: orders.length > 0 ? `${((deliveredOrders.length / orders.length) * 100).toFixed(1)}%` : '0%',
      delivered: deliveredOrders.length,
      cancelled: cancelledOrders.length,
      refunded: 0,
      topItem: topItemName,
      topSales: topSales.toString(),
      topRevenue: `EGP ${(topSales * 0).toFixed(2)}`,
      revenueTrend,
      orderVolume,
      peakHours: hours
    };
  }

  /**
   * Verify that the restaurant is owned by the given vendor.
   */
  private async verifyOwnership(restaurantId: string, ownerId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (restaurant.ownerId !== ownerId) {
      throw new ForbiddenException(
        'You do not have permission to modify this restaurant',
      );
    }

    return restaurant;
  }
}
