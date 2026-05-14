import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountStatus, Role, OrderStatus, LedgerType } from '@prisma/client';
import { SignatureUtil } from '../wallet/signature.util';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseAdminService,
    private readonly notifications: NotificationsService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  private async createAuditLog(
    userId: string,
    action: string,
    targetTable?: string,
    targetId?: string,
    newData?: any,
    oldData?: any,
  ) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      await this.prisma.auditLog.create({
        data: {
          userId,
          userRole: user?.role,
          action,
          targetTable,
          targetId,
          newData: newData || {},
          oldData: oldData || {},
        },
      });
    } catch (err) {
      this.logger.error('Failed to create audit log:', err);
    }
  }

  // =============================================
  // ANALYTICS / DASHBOARD
  // =============================================

  async getDashboardAnalytics() {
    const cacheKey = 'admin:dashboard:analytics';
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      this.logger.warn('Redis read failed for analytics cache');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const lastMonthStart = new Date(today);
    lastMonthStart.setDate(today.getDate() - 60);

    const [
      totalUsers,
      totalOrders,
      revenueAgg,
      pendingOrders,
      activeVendors,
      pendingDrivers,
      activeOrdersCount,
      onlineDriversCount,
      openRestaurantsCount,
      recentOrdersList,
      topVendors,
      monthlyOrders,
      lastMonthOrders,
      monthlyRevenue,
      lastMonthRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.CUSTOMER, deletedAt: null } }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({ _sum: { total: true }, where: { status: OrderStatus.DELIVERED } }),
      this.prisma.order.count({ where: { status: OrderStatus.PENDING } }),
      this.prisma.restaurant.count({ where: { status: AccountStatus.ACTIVE } }),
      this.prisma.driverProfile.count({ where: { applicationStatus: 'PENDING' } }),
      
      // REAL-TIME STATS
      this.prisma.order.count({
        where: { status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.RETURNED] } },
      }),
      this.prisma.driverProfile.count({
        where: { isAvailable: true }, 
      }),
      this.prisma.restaurant.count({
        where: { isOpen: true, status: AccountStatus.ACTIVE },
      }),

      // Recent Orders
      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          restaurant: { select: { name: true } },
        },
      }),
      // Top Vendors by orders
      this.prisma.restaurant.findMany({
        where: { status: AccountStatus.ACTIVE },
        take: 5,
        orderBy: { rating: 'desc' },
        include: {
          _count: { select: { orders: { where: { status: OrderStatus.DELIVERED } } } },
        },
      }),
      // This month orders count
      this.prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      // Last month orders count
      this.prisma.order.count({ where: { createdAt: { gte: lastMonthStart, lt: thirtyDaysAgo } } }),
      // This month revenue
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: OrderStatus.DELIVERED, createdAt: { gte: thirtyDaysAgo } },
      }),
      // Last month revenue
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: OrderStatus.DELIVERED, createdAt: { gte: lastMonthStart, lt: thirtyDaysAgo } },
      }),
    ]);

    // Firebase pending applications count
    let fbPendingCount = 0;
    try {
      const db = this.firebase.getFirestore();
      if (db) {
        const [fbVendorsSnap, fbDriversSnap] = await Promise.all([
          db.collection('vendor_applications').get(),
          db.collection('driver_applications').get(),
        ]);
        
        const pendingVendors = fbVendorsSnap.docs.filter(d => (d.data().status || '').toLowerCase() === 'pending').length;
        const pendingDrivers = fbDriversSnap.docs.filter(d => (d.data().status || '').toLowerCase() === 'pending').length;
        fbPendingCount = pendingVendors + pendingDrivers;
      }
    } catch (err) {
      this.logger.warn('Failed to fetch FB pending counts: ' + err.message);
    }

    // Monthly revenue chart (last 7 days)
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    
    const ordersLast7Days = await this.prisma.order.findMany({
      where: { 
        status: OrderStatus.DELIVERED, 
        createdAt: { gte: sevenDaysAgo } 
      },
      select: { createdAt: true, total: true },
    });

    const revenueChart: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().split('T')[0];
      revenueChart[key] = 0;
    }

    ordersLast7Days.forEach(o => {
      const key = o.createdAt.toISOString().split('T')[0];
      if (revenueChart[key] !== undefined) {
        revenueChart[key] += Number(o.total || 0);
      }
    });

    const monthlyRevenueHistory = Object.entries(revenueChart)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const thisMonthRev = Number(monthlyRevenue?._sum?.total || 0);
    const lastMonthRev = Number(lastMonthRevenue?._sum?.total || 0);
    const revTrend = lastMonthRev > 0 ? (((thisMonthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1) + '%' : '+0%';
    const orderTrend = lastMonthOrders > 0 ? (((Number(monthlyOrders || 0) - Number(lastMonthOrders || 0)) / Number(lastMonthOrders || 0)) * 100).toFixed(1) + '%' : '+0%';

    // Role and Status distributions
    const [userRoles, orderStatuses] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: true, where: { deletedAt: null } }),
      this.prisma.order.groupBy({ by: ['status'], _count: true }),
    ]);

    const userRolesMap: Record<string, number> = {};
    userRoles.forEach((r: any) => { 
      const count = typeof r._count === 'object' ? (r._count._all || Object.values(r._count)[0]) : r._count;
      userRolesMap[r.role as string] = Number(count || 0); 
    });

    const orderStatusesMap: Record<string, number> = {};
    orderStatuses.forEach((s: any) => { 
      const count = typeof s._count === 'object' ? (s._count._all || Object.values(s._count)[0]) : s._count;
      orderStatusesMap[s.status as string] = Number(count || 0); 
    });

    const result = {
      stats: {
        totalUsers: { value: Number(totalUsers || 0), trend: '+5%' },
        totalOrders: { value: Number(totalOrders || 0), trend: orderTrend || '+0%' },
        totalRevenue: { value: Number(revenueAgg?._sum?.total || 0), trend: revTrend || '+0%' },
        pendingOrders: { value: Number(pendingOrders || 0) + fbPendingCount, trend: '' },
        activeOrders: { value: Number(activeOrdersCount || 0) },
        onlineDrivers: { value: Number(onlineDriversCount || 0) },
        openRestaurants: { value: Number(openRestaurantsCount || 0) },
        health: { status: 'Stable', uptime: '99.9%' },
      },
      recentOrders: (recentOrdersList || []).map((o: any) => ({
        id: o.firebaseOrderId || o.id?.slice(0, 8) || 'N/A',
        customer: o.customer?.name || 'Unknown',
        vendor: o.restaurant?.name || 'Unknown',
        amount: Number(o.total || 0),
        status: o.status || 'UNKNOWN',
        date: o.createdAt || new Date(),
      })),
      topVendors: (topVendors || []).map((v: any) => ({
        id: v.id,
        name: v.name || 'Unknown',
        rating: Number(v.rating || 0),
        ordersCount: Number(v._count?.orders || 0),
        revenue: Number(v.totalEarnings || 0),
      })),
      revenueChart: monthlyRevenueHistory || [],
      distributions: {
        roles: userRolesMap || {},
        orderStatuses: orderStatusesMap || {},
      }
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // Cache for 5 mins
    } catch (err) {
      this.logger.warn('Failed to save analytics to Redis cache');
    }

    return result;
  }

  // =============================================
  // USERS
  // =============================================

  async getAllUsers(filters: {
    page?: number;
    limit?: number;
    role?: string;
    status?: string;
    search?: string;
  }) {
    const { page = 1, limit = 20, role, status, search } = filters;
    const where: any = { deletedAt: null };

    if (role && role !== 'all') where.role = role.toUpperCase();
    if (status && status !== 'all') where.status = status.toUpperCase();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          walletBalance: true,
          createdAt: true,
          profileImage: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        addresses: true,
        driverProfile: { 
          include: { 
            vehicle: true,
            deliveries: { 
              take: 10, 
              orderBy: { createdAt: 'desc' },
              include: { restaurant: { select: { name: true } }, driver: { include: { user: { select: { name: true } } } } }
            }
          } 
        },
        ownedRestaurants: {
          include: {
            orders: {
              take: 10,
              orderBy: { createdAt: 'desc' },
              include: { driver: { include: { user: { select: { name: true } } } } }
            }
          }
        },
        ledgers: { orderBy: { createdAt: 'desc' } },
        orders: { 
          take: 10, 
          orderBy: { createdAt: 'desc' },
          include: { restaurant: { select: { name: true } }, driver: { include: { user: { select: { name: true } } } } }
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const u = user as any;
    // Merge orders from all roles (Customer, Driver, Vendor)
    const driverOrders = u.driverProfile?.deliveries || [];
    const customerOrders = u.orders || [];
    const vendorOrders = u.ownedRestaurants?.flatMap((r: any) => r.orders || []) || [];
    
    // Sort merged orders by date
    const allOrders = [...customerOrders, ...driverOrders, ...vendorOrders]
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 15);

    return {
      ...user,
      orders: allOrders,
      // Aggregated Financial Info for the UI
      businessBalance: u.ownedRestaurants?.reduce((sum: number, r: any) => sum + (r.walletBalance || 0) + (r.pendingBalance || 0), 0) || 0,
      driverEarnings: u.driverProfile?.totalEarnings || 0,
      driverDebt: u.driverProfile?.debtBalance || 0,
    };
  }

  async updateUserStatus(id: string, status: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const validStatuses = ['ACTIVE', 'INACTIVE', 'BANNED', 'SUSPENDED', 'PENDING_VERIFICATION'];
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new BadRequestException(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    return this.prisma.user.update({
      where: { id },
      data: { status: status.toUpperCase() as any },
    });
  }

  async updateUserRole(adminId: string, targetUserId: string, newRole: string) {
    // 1. Verify admin is SuperAdmin
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Only SuperAdmin can change user roles');
    }

    // 2. Prevent self-role change
    if (adminId === targetUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException('User not found');

    const validRoles = Object.values(Role);
    if (!validRoles.includes(newRole.toUpperCase() as any)) {
      throw new BadRequestException(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: newRole.toUpperCase() as any },
    });
  }

  async resetUserPassword(targetUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException('User not found');

    // Generate strong random password
    const newPassword = crypto.randomBytes(8).toString('hex'); // 16 chars hex
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash: hashedPassword },
    });

    return { 
      message: 'Password reset successfully',
      newPassword: newPassword 
    };
  }

  async updateOwnName(userId: string, newName: string) {
    if (!newName || newName.trim().length < 2) {
      throw new BadRequestException('Name must be at least 2 characters long');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { name: newName.trim() },
    });
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    // Soft delete
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { message: 'User deleted successfully' };
  }

  // =============================================
  // DRIVERS
  // =============================================

  async getDriverApplications(status?: string) {
    const where: any = {};
    if (status && status !== 'all') {
      where.applicationStatus = status.toUpperCase();
    }

    const drivers = await this.prisma.driverProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, createdAt: true },
        },
        vehicle: true,
      },
    });

    return drivers.map(d => ({
      id: d.id,
      userId: d.userId,
      name: d.user.name,
      email: d.user.email,
      phone: d.user.phone || '',
      status: d.applicationStatus,
      submitted: d.createdAt,
      personal: {
        name: d.user.name,
        email: d.user.email,
        phone: d.user.phone || '',
        nationalId: d.nationalId,
        dateOfBirth: d.dateOfBirth,
      },
      vehicle: d.vehicle ? {
        type: d.vehicle.type,
        make: d.vehicle.make,
        model: d.vehicle.model,
        year: d.vehicle.year,
        color: d.vehicle.color,
        plateNumber: d.vehicle.plateNumber,
      } : null,
      documents: {
        nationalIdUrl: d.nationalIdUrl,
        driverLicenseUrl: d.driverLicenseUrl,
      },
    }));
  }

  async approveDriver(driverProfileId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { user: true },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');

    await this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: { applicationStatus: 'APPROVED' as any },
    });

    // Notify driver
    try {
      await this.notifications.createNotification(
        profile.userId,
        'Application Approved! 🎉',
        'Congratulations! Your driver application has been approved. You can now start receiving delivery requests.',
        'driver_approved',
      );
    } catch (err) {
      this.logger.warn(`Failed to notify driver ${profile.userId}: ${err.message}`);
    }

    return { message: 'Driver approved successfully' };
  }

  async rejectDriver(driverProfileId: string, reason?: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { user: true },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');

    await this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: { applicationStatus: 'REJECTED' as any },
    });

    // Notify driver
    try {
      await this.notifications.createNotification(
        profile.userId,
        'Application Update',
        reason
          ? `Your driver application was not approved. Reason: ${reason}`
          : 'Your driver application was not approved at this time.',
        'driver_rejected',
      );
    } catch (err) {
      this.logger.warn(`Failed to notify driver ${profile.userId}: ${err.message}`);
    }

    return { message: 'Driver rejected' };
  }

  // =============================================
  // RESTAURANTS / VENDORS (PostgreSQL)
  // =============================================

  async getRestaurantApplications(status?: string, vendorType?: string) {
    const where: any = {};
    
    if (status && status !== 'all') {
      const s = status.toUpperCase();
      if (s === 'PENDING') {
        where.status = AccountStatus.PENDING_VERIFICATION;
      } else if (s === 'APPROVED') {
        where.status = AccountStatus.ACTIVE;
      } else {
        // Fallback for direct status matches
        where.status = s as any;
      }
    }
    // If status is 'all', we don't apply any status filter

    if (vendorType && vendorType !== 'all') {
      const t = vendorType.toUpperCase();
      if (t === 'RESTAURANT') {
        where.OR = [
          { vendorType: { equals: 'RESTAURANT', mode: 'insensitive' } },
          { vendorType: { equals: 'FOOD', mode: 'insensitive' } },
          { vendorType: null },
        ];
      } else if (t === 'MARKET') {
        where.OR = [
          { vendorType: { equals: 'MARKET', mode: 'insensitive' } },
          { vendorType: { equals: 'GROCERY', mode: 'insensitive' } },
          { vendorType: { equals: 'SUPERMARKET', mode: 'insensitive' } },
        ];
      } else if (t === 'PHARMACY') {
        where.OR = [
          { vendorType: { equals: 'PHARMACY', mode: 'insensitive' } },
          { vendorType: { equals: 'MEDICINE', mode: 'insensitive' } },
        ];
      } else {
        where.vendorType = { equals: t, mode: 'insensitive' };
      }
    }

    const data = await this.prisma.restaurant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    return data.map(r => ({
      id: r.id,
      name: r.name,
      nameAr: r.nameAr,
      type: r.vendorType || 'RESTAURANT',
      status: r.status,
      date: r.createdAt,
      phone: r.owner?.phone,
      email: r.owner?.email,
      address: r.address,
      city: r.city,
      ownerId: r.ownerId,
      ownerName: r.owner?.name,
      documentUrls: r.documentUrls,
      logoUrl: r.logoUrl,
    }));
  }

  async getAllVendors(filters: { page?: number; limit?: number; type?: string; status?: string; search?: string }) {
    const { page = 1, limit = 20, type, status, search } = filters;
    const where: any = {};

    if (type && type !== 'all') {
      const t = type.toUpperCase();
      if (t === 'RESTAURANT') {
        where.OR = [{ vendorType: 'RESTAURANT' }, { vendorType: 'FOOD' }, { vendorType: null }];
      } else if (t === 'MARKET') {
        where.OR = [{ vendorType: 'MARKET' }, { vendorType: 'GROCERY' }, { vendorType: 'SUPERMARKET' }];
      } else if (t === 'PHARMACY') {
        where.OR = [{ vendorType: 'PHARMACY' }, { vendorType: 'MEDICINE' }];
      } else {
        where.vendorType = t;
      }
    }
    if (status && status !== 'all') where.status = status.toUpperCase();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameAr: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, name: true, email: true, phone: true } },
          _count: { select: { orders: true } },
        },
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return {
      data: data.map(r => ({
        id: r.id,
        name: r.name,
        nameAr: r.nameAr,
        type: r.vendorType || 'RESTAURANT',
        status: r.status,
        rating: r.rating,
        ordersCount: r._count.orders,
        revenue: r.walletBalance,
        owner: r.owner,
        city: r.city,
        logoUrl: r.logoUrl,
        createdAt: r.createdAt,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  async approveRestaurant(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { owner: true },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { status: AccountStatus.ACTIVE, isActive: true },
    });

    // Update owner role to VENDOR
    await this.prisma.user.update({
      where: { id: restaurant.ownerId },
      data: { role: Role.VENDOR },
    });

    // Notify vendor
    try {
      await this.notifications.createNotification(
        restaurant.ownerId,
        'Restaurant Approved! 🎉',
        `Your restaurant "${restaurant.name}" has been approved and is now live on Z-Speed!`,
        'restaurant_approved',
      );
    } catch (err) {
      this.logger.warn(`Failed to notify vendor ${restaurant.ownerId}: ${err.message}`);
    }

    return { message: 'Restaurant approved and vendor role granted' };
  }

  async rejectRestaurant(restaurantId: string, reason?: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { owner: true },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { status: AccountStatus.INACTIVE, isActive: false },
    });

    try {
      await this.notifications.createNotification(
        restaurant.ownerId,
        'Application Update',
        reason
          ? `Your application for "${restaurant.name}" was not approved. Reason: ${reason}`
          : `Your application for "${restaurant.name}" was not approved at this time.`,
        'restaurant_rejected',
      );
    } catch (err) {
      this.logger.warn(`Failed to notify vendor ${restaurant.ownerId}: ${err.message}`);
    }

    return { message: 'Restaurant rejected' };
  }

  async updateVendorStatus(restaurantId: string, status: string) {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION'];
    const upperStatus = status.toUpperCase();
    if (!validStatuses.includes(upperStatus)) {
      throw new BadRequestException(`Invalid status`);
    }
    return this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        status: upperStatus as AccountStatus,
        isActive: upperStatus === 'ACTIVE',
        isOpen: upperStatus === 'ACTIVE' ? undefined : false,
      },
    });
  }

  // =============================================
  // FIREBASE — VENDOR APPLICATIONS (from Firestore)
  // =============================================

  async getVendorApplicationsFromFirebase(status?: string) {
    const db = this.firebase.getFirestore();
    if (!db) {
      this.logger.warn('Firestore not initialized, returning empty vendor applications');
      return [];
    }

    try {
      const snapshot = await db.collection('vendor_applications').get();
      const applications: any[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data();
        const appStatus = (data.status || 'pending').toLowerCase();
        
        if (status && status !== 'all') {
          if (appStatus !== status.toLowerCase()) return;
        }

        applications.push({
          id: doc.id,
          source: 'firebase',
          name: data.businessName || data.name,
          type: data.vendorType || data.type || 'RESTAURANT',
          status: data.status || 'pending',
          ownerName: data.ownerName || data.contactName,
          email: data.email,
          phone: data.phone,
          address: data.address,
          city: data.city,
          documentUrls: data.documentUrls || [],
          logoUrl: data.logoUrl,
          userId: data.userId || data.uid,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt || 0),
          rawData: data,
        });
      });

      // Sort in memory (descending)
      return applications.sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return dateB - dateA;
      });
    } catch (err) {
      this.logger.error('Failed to fetch vendor applications from Firebase:', err.message);
      return [];
    }
  }

  async approveFirebaseVendorApplication(applicationId: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new BadRequestException('Firebase not available');

    const docRef = db.collection('vendor_applications').doc(applicationId);
    const doc = await docRef.get();
    if (!doc.exists) throw new NotFoundException('Application not found in Firebase');

    const data = doc.data() as any;

    // 1. Update Firebase status
    await docRef.update({
      status: 'approved',
      approvedAt: new Date(),
    });

    // 2. If user exists in PostgreSQL, create restaurant & update role
    if (data.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
      if (user) {
        // Create restaurant in PostgreSQL
        await this.prisma.restaurant.create({
          data: {
            ownerId: data.userId,
            name: data.businessName || data.name || 'New Restaurant',
            nameAr: data.businessNameAr || null,
            address: data.address || '',
            city: data.city || '',
            vendorType: data.vendorType || 'RESTAURANT',
            status: AccountStatus.ACTIVE,
            isActive: true,
            documentUrls: data.documentUrls || [],
            payoutPhoneNumber: data.phone,
          },
        });

        // Update user role to VENDOR
        await this.prisma.user.update({
          where: { id: data.userId },
          data: { role: Role.VENDOR },
        });

        // Send notification
        try {
          await this.notifications.createNotification(
            data.userId,
            'Application Approved! 🎉',
            `Your application for "${data.businessName || data.name}" has been approved!`,
            'vendor_approved',
          );
        } catch (err) {
          this.logger.warn(`Notification failed: ${err.message}`);
        }
      }
    }

    return { message: 'Firebase vendor application approved and synced to database' };
  }

  async rejectFirebaseVendorApplication(applicationId: string, reason?: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new BadRequestException('Firebase not available');

    const docRef = db.collection('vendor_applications').doc(applicationId);
    const doc = await docRef.get();
    if (!doc.exists) throw new NotFoundException('Application not found in Firebase');

    const data = doc.data() as any;

    await docRef.update({
      status: 'rejected',
      rejectionReason: reason || 'Application did not meet requirements',
      rejectedAt: new Date(),
    });

    if (data.userId) {
      try {
        await this.notifications.createNotification(
          data.userId,
          'Application Update',
          reason ? `Your application was not approved. Reason: ${reason}` : 'Your application was not approved.',
          'vendor_rejected',
        );
      } catch (err) {
        this.logger.warn(`Notification failed: ${err.message}`);
      }
    }

    return { message: 'Firebase vendor application rejected' };
  }

  // =============================================
  // FIREBASE — DRIVER APPLICATIONS
  // =============================================

  async getDriverApplicationsFromFirebase(status?: string) {
    const db = this.firebase.getFirestore();
    if (!db) return [];

    try {
      const snapshot = await db.collection('driver_applications').get();
      const applications: any[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data();
        const appStatus = (data.status || 'pending').toLowerCase();
        
        // Manual status filtering
        if (status && status !== 'all') {
          if (appStatus !== status.toLowerCase()) return;
        }

        applications.push({
          id: doc.id,
          source: 'firebase',
          name: data.name || data.displayName,
          email: data.email,
          phone: data.phone,
          status: data.status || 'pending',
          userId: data.userId || data.uid,
          personal: data.personal || {},
          vehicle: data.vehicle || {},
          documents: data.documents || {},
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt || 0),
          rawData: data,
        });
      });

      // Sort in memory (descending)
      return applications.sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return dateB - dateA;
      });
    } catch (err) {
      this.logger.error('Failed to fetch driver applications from Firebase:', err.message);
      return [];
    }
  }

  async approveFirebaseDriverApplication(applicationId: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new BadRequestException('Firebase not available');

    const docRef = db.collection('driver_applications').doc(applicationId);
    const doc = await docRef.get();
    if (!doc.exists) throw new NotFoundException('Application not found');

    const data = doc.data() as any;

    await docRef.update({ status: 'approved', approvedAt: new Date() });

    if (data.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
      if (user) {
        const profile = await this.prisma.driverProfile.upsert({
          where: { userId: data.userId },
          update: { applicationStatus: 'APPROVED' as any, isAvailable: true },
          create: { userId: data.userId, applicationStatus: 'APPROVED' as any, isAvailable: true }
        });

        if (data.vehicle) {
          await this.prisma.vehicle.create({
            data: {
              driverProfileId: profile.id,
              type: data.vehicle.type || 'BIKE',
              make: data.vehicle.make || 'Unknown',
              model: data.vehicle.model || 'Unknown',
              year: Number(data.vehicle.year) || 2024,
              color: data.vehicle.color || 'Unknown',
              plateNumber: data.vehicle.plateNumber || 'Unknown',
            }
          }).catch(() => {});
        }

        await this.prisma.user.update({ where: { id: data.userId }, data: { role: Role.DRIVER } });

        try {
          await this.notifications.createNotification(
            data.userId,
            'Driver Application Approved! 🚀',
            'Your application has been approved. Welcome to Z-Speed!',
            'driver_approved',
          );
        } catch {}
      }
    }

    return { message: 'Driver application approved and synced' };
  }

  async rejectFirebaseDriverApplication(applicationId: string, reason?: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new BadRequestException('Firebase not available');

    const docRef = db.collection('driver_applications').doc(applicationId);
    await docRef.update({
      status: 'rejected',
      rejectionReason: reason || 'Requirements not met',
      rejectedAt: new Date(),
    });

    return { message: 'Driver application rejected' };
  }

  async getPendingApplications() {
    const [drivers, restaurants] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where: { applicationStatus: 'PENDING' as any },
        include: { user: true },
      }),
      this.prisma.restaurant.findMany({
        where: { status: AccountStatus.PENDING_VERIFICATION },
        include: { owner: true },
      }),
    ]);

    // Firebase applications
    let firebaseVendorApps: any[] = [];
    let firebaseDriverApps: any[] = [];
    
    try {
      [firebaseVendorApps, firebaseDriverApps] = await Promise.all([
        this.getVendorApplicationsFromFirebase('pending'),
        this.getDriverApplicationsFromFirebase('pending')
      ]);
    } catch (err) {
      this.logger.warn('Could not fetch Firebase applications: ' + err.message);
    }

    return { 
      drivers, 
      restaurants, 
      firebaseVendorApplications: firebaseVendorApps,
      firebaseDriverApplications: firebaseDriverApps 
    };
  }

  // =============================================
  // ORDERS
  // =============================================

  async getAllOrders(filters: { page?: number; limit?: number; status?: string; search?: string }) {
    const { page = 1, limit = 20, status, search } = filters;
    const where: any = {};
    if (status && status !== 'all') where.status = status.toUpperCase();

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { firebaseOrderId: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } },
        { restaurant: { name: { contains: search, mode: 'insensitive' } } },
        { driver: { user: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          restaurant: { select: { id: true, name: true, logoUrl: true } },
          driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
          items: { include: { foodItem: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrderById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, profileImage: true } },
        restaurant: { select: { id: true, name: true, logoUrl: true, address: true, city: true, owner: { select: { name: true, phone: true } } } },
        driver: { include: { user: { select: { id: true, name: true, phone: true, profileImage: true } }, vehicle: true } },
        items: { include: { foodItem: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // =============================================
  // SETTLEMENTS
  // =============================================

  async getSettlements() {
    const [
      appEarnings,
      vendorEarnings,
      driverEarnings,
      payouts,
      vendors,
      drivers,
      pendingEarnings,
    ] = await Promise.all([
      // Total App Earnings
      this.prisma.order.aggregate({
        where: { status: OrderStatus.DELIVERED },
        _sum: { appShare: true, serviceFee: true },
      }),
      // Total Vendor Earnings
      this.prisma.restaurant.aggregate({
        _sum: { totalEarnings: true },
      }),
      // Total Driver Earnings
      this.prisma.driverProfile.aggregate({
        _sum: { totalEarnings: true },
      }),
      // Historical Payouts
      this.prisma.ledger.findMany({
        where: { type: { in: [LedgerType.WITHDRAWAL, LedgerType.PAYOUT] } },
        include: { user: { select: { id: true, name: true, role: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // Vendors (All, to show they exist)
      this.prisma.restaurant.findMany({
        select: { id: true, name: true, pendingBalance: true, walletBalance: true, totalEarnings: true, ownerId: true },
        orderBy: { name: 'asc' },
      }),
      // Drivers (All, to show they exist)
      this.prisma.driverProfile.findMany({
        select: { id: true, totalEarnings: true, debtBalance: true, user: { select: { id: true, name: true, walletBalance: true } } },
        orderBy: { user: { name: 'asc' } },
      }),
      // Pending Earning entries
      this.prisma.ledger.findMany({
        where: { status: 'pending', type: LedgerType.EARNING },
        include: { user: { select: { name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const result = {
      earnings: {
        app: Number(appEarnings?._sum?.appShare || 0) + Number(appEarnings?._sum?.serviceFee || 0),
        vendors: Number(vendorEarnings?._sum?.totalEarnings || 0),
        drivers: Number(driverEarnings?._sum?.totalEarnings || 0),
        totalVolume: Number(appEarnings?._sum?.appShare || 0) + Number(vendorEarnings?._sum?.totalEarnings || 0) + Number(driverEarnings?._sum?.totalEarnings || 0),
      },
      payouts: payouts || [],
      vendors: (vendors || []).map((v: any) => {
        const pBal = Number(v.pendingBalance || 0);
        const wBal = Number(v.walletBalance || 0);
        return {
          id: v.id,
          ownerId: v.ownerId,
          name: v.name || 'Unknown',
          pendingBalance: pBal,
          walletBalance: wBal,
          totalEarnings: Number(v.totalEarnings || 0),
          balance: pBal + wBal,
        };
      }).sort((a, b) => b.balance - a.balance),
      drivers: (drivers || []).map((d: any) => {
        const wBal = Number(d.user?.walletBalance || 0);
        const earnings = Number(d.totalEarnings || 0);
        const debt = Number(d.debtBalance || 0);
        return {
          id: d.id,
          userId: d.user?.id,
          name: d.user?.name || 'Unknown',
          balance: wBal || (earnings - debt) || 0,
          walletBalance: wBal,
          debt: debt,
          totalEarnings: earnings,
        };
      }).sort((a, b) => b.balance - a.balance),
      pendingEarnings: (pendingEarnings || []).map((le: any) => ({
        id: le.id,
        createdAt: le.createdAt,
        amount: Number(le.amount || 0),
        status: le.status,
        user: {
          id: le.user?.id,
          name: le.user?.name || 'Unknown',
          role: le.user?.role || 'USER'
        }
      })),
    };

    return result;
  }

  async exportTransactionsCsv(filters: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = filters;
    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const ledgers = await this.prisma.ledger.findMany({
      where,
      include: { user: { select: { name: true, role: true } }, order: { select: { firebaseOrderId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Create CSV header
    let csv = 'ID,Date,User,Role,Type,Amount,Status,Order ID,Description\n';

    // Add rows
    for (const l of ledgers) {
      const row = [
        l.id,
        l.createdAt.toISOString(),
        `"${l.user.name}"`,
        l.user.role,
        l.type,
        l.amount,
        l.status,
        l.order?.firebaseOrderId || '',
        `"${l.description || ''}"`,
      ].join(',');
      csv += row + '\n';
    }

    return csv;
  }

  // =============================================
  // PROCESS PAYOUT
  // =============================================

  async processPayout(dto: { userId: string, amount: number, notes?: string }) {
    const { userId, amount, notes } = dto;
    
    const user = await this.prisma.user.findUnique({ 
      where: { id: userId },
      include: { ownedRestaurants: true }
    });
    if (!user) throw new NotFoundException('User not found');
    
    // Calculate total available balance (User wallet + Restaurant pending balances)
    const restaurantPendingTotal = user.ownedRestaurants.reduce((sum, r) => sum + (r.pendingBalance || 0), 0);
    const totalAvailable = user.walletBalance + restaurantPendingTotal;

    if (totalAvailable < amount) {
      throw new BadRequestException(`Insufficient balance. Available: EGP ${totalAvailable.toFixed(2)}`);
    }

    // Wrap in a transaction
    await this.prisma.$transaction(async (tx) => {
      let remainingToDeduct = amount;

      // 1. Deduct from User Wallet first
      if (user.walletBalance > 0) {
        const deductFromWallet = Math.min(user.walletBalance, remainingToDeduct);
        await tx.user.update({
          where: { id: userId },
          data: { walletBalance: { decrement: deductFromWallet } },
        });
        remainingToDeduct -= deductFromWallet;
      }

      // 2. Deduct remaining from Restaurant Pending Balances
      if (remainingToDeduct > 0) {
        for (const restaurant of user.ownedRestaurants) {
          if (remainingToDeduct <= 0) break;
          const deductFromRest = Math.min(restaurant.pendingBalance || 0, remainingToDeduct);
          if (deductFromRest > 0) {
            await tx.restaurant.update({
              where: { id: restaurant.id },
              data: { pendingBalance: { decrement: deductFromRest } },
            });
            remainingToDeduct -= deductFromRest;
          }
        }
      }

      // 3. Create Ledger Entry
      await tx.ledger.create({
        data: {
          userId,
          type: 'WITHDRAWAL',
          amount: -amount,
          status: 'completed',
          description: notes || 'Admin initiated payout',
          referenceId: `payout_${Date.now()}_${userId.slice(0, 5)}`,
          signature: SignatureUtil.signLedgerEntry({
            userId,
            type: 'WITHDRAWAL',
            amount: -amount,
          } as any)
        }
      });
    });

    return { message: 'Payout processed successfully' };
  }

  // =============================================
  // SETTINGS
  // =============================================

  async getSettings() {
    let config = await this.prisma.systemConfig.findUnique({ where: { id: 'default' } });
    if (!config) {
      config = await this.prisma.systemConfig.create({ data: { id: 'default' } });
    }
    return config;
  }

  async updateSettings(dto: any) {
    const config = await this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...dto },
      update: dto,
    });

    // Sync to Firebase for mobile apps to pick up
    const firestore = this.firebase.getFirestore();
    if (firestore) {
      try {
        await firestore.collection('system_config').doc('default').set({
          ...dto,
          updatedAt: new Date(),
        }, { merge: true });
        this.logger.log('System settings synced to Firebase');
      } catch (err) {
        this.logger.error('Failed to sync settings to Firebase:', err);
      }
    }

    return config;
  }

  // =============================================
  // AUDIT LOGS
  // =============================================

  async getAuditLogs(page = 1, limit = 50) {
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { name: true, email: true, role: true } } },
      }),
      this.prisma.auditLog.count(),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async getMapData() {
    const [drivers, restaurants, recentOrders] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where: { isAvailable: true, applicationStatus: 'APPROVED' },
        include: {
          user: { select: { id: true, name: true, phone: true } },
          vehicle: true,
        },
      }),
      this.prisma.restaurant.findMany({
        select: {
          id: true,
          name: true,
          nameAr: true,
          latitude: true,
          longitude: true,
          status: true,
          isOpen: true,
          vendorType: true,
          logoUrl: true,
        },
      }),
      this.prisma.order.findMany({
        where: { 
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
          deliveryLat: { not: 0 },
          deliveryLng: { not: 0 }
        },
        select: { deliveryLat: true, deliveryLng: true },
        take: 500, // Limit for performance
      }),
    ]);

    return { 
      drivers, 
      restaurants, 
      heatmap: recentOrders.map(o => [o.deliveryLat, o.deliveryLng, 0.5]) // [lat, lng, intensity]
    };
  }

  async reconcileFinancials() {
    const [drivers, restaurants] = await Promise.all([
      this.prisma.driverProfile.findMany({ include: { user: { select: { walletBalance: true } } } }),
      this.prisma.restaurant.findMany({ select: { id: true, walletBalance: true, name: true, ownerId: true } }),
    ]);

    const issues = [];

    // Check Drivers
    for (const driver of drivers) {
      const ledgerSum = await this.prisma.ledger.aggregate({
        where: { userId: driver.userId, status: 'completed' },
        _sum: { amount: true },
      });
      const expectedBalance = ledgerSum._sum.amount || 0;
      if (Math.abs(expectedBalance - driver.user.walletBalance) > 0.01) {
        issues.push({
          type: 'DRIVER',
          id: driver.id,
          userId: driver.userId,
          stored: driver.user.walletBalance,
          calculated: expectedBalance,
          diff: expectedBalance - driver.user.walletBalance,
        });
      }
    }

    // Check Restaurants
    for (const rest of restaurants) {
      const ledgerSum = await this.prisma.ledger.aggregate({
        where: { userId: rest.ownerId, status: 'completed' },
        _sum: { amount: true },
      });
      const expectedBalance = ledgerSum._sum.amount || 0;
      if (Math.abs(expectedBalance - rest.walletBalance) > 0.01) {
        issues.push({
          type: 'RESTAURANT',
          id: rest.id,
          name: rest.name,
          stored: rest.walletBalance,
          calculated: expectedBalance,
          diff: expectedBalance - rest.walletBalance,
        });
      }
    }

    return { totalChecked: drivers.length + restaurants.length, issuesFound: issues.length, issues };
  }

  async getExportData(type: 'orders' | 'settlements') {
    if (type === 'orders') {
      const orders = await this.prisma.order.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true } }, restaurant: { select: { name: true } } },
      });

      const header = 'ID,Date,Customer,Vendor,Status,Total,Payment\n';
      const rows = orders.map(o => 
        `${o.id},${o.createdAt.toISOString()},"${o.customer?.name}","${o.restaurant?.name}",${o.status},${o.total},${o.paymentMethod}`
      ).join('\n');
      return header + rows;
    } else {
      const settlements = await this.prisma.ledger.findMany({
        where: { type: 'PAYOUT' },
        take: 1000,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, email: true } } },
      });

      const header = 'ID,Date,Recipient,Email,Amount,Status,Description\n';
      const rows = settlements.map(s => 
        `${s.id},${s.createdAt.toISOString()},"${s.user?.name}",${s.user?.email},${s.amount},${s.status},"${s.description || ''}"`
      ).join('\n');
      return header + rows;
    }
  }

  /**
   * Automate financial reconciliation every night at midnight.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyFinancialReconciliation() {
    this.logger.log('Starting daily financial reconciliation cron job...');
    const result = await this.reconcileFinancials();
    
    if (result.issuesFound > 0) {
      await this.notifications.sendAdminAlert(
        'Financial Discrepancy Found',
        `Audit found ${result.issuesFound} discrepancies in user wallets. Total Checked: ${result.totalChecked}.`,
        { result }
      );
    } else {
      this.logger.log('Daily financial reconciliation completed: No issues found.');
    }
  }

  /**
   * Monitor operational health every hour.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runOperationalHealthCheck() {
    this.logger.log('Running operational health check...');
    
    // Check for high volume of pending orders (> 20)
    const pendingCount = await this.prisma.order.count({ where: { status: OrderStatus.PENDING } });
    if (pendingCount > 20) {
      await this.notifications.sendAdminAlert(
        'High Pending Order Volume',
        `There are currently ${pendingCount} pending orders. System may be overloaded or drivers unavailable.`,
        { pendingCount }
      );
    }

    // Check for restaurants that might be offline during peak hours (example)
    // (This is just a placeholder for more complex logic)
  }
}
