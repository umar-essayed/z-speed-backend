import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountStatus, Role } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseAdminService,
    private readonly notifications: NotificationsService,
  ) {}

  // =============================================
  // ANALYTICS / DASHBOARD
  // =============================================

  async getDashboardAnalytics() {
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
      recentOrdersList,
      topVendors,
      monthlyOrders,
      lastMonthOrders,
      monthlyRevenue,
      lastMonthRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.CUSTOMER, deletedAt: null } }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'DELIVERED' } }),
      this.prisma.order.count({ where: { status: 'PENDING' } }),
      this.prisma.restaurant.count({ where: { status: AccountStatus.ACTIVE } }),
      this.prisma.driverProfile.count({ where: { applicationStatus: 'PENDING' } }),
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
          _count: { select: { orders: { where: { status: 'DELIVERED' } } } },
        },
      }),
      // This month orders count
      this.prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      // Last month orders count
      this.prisma.order.count({ where: { createdAt: { gte: lastMonthStart, lt: thirtyDaysAgo } } }),
      // This month revenue
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: 'DELIVERED', createdAt: { gte: thirtyDaysAgo } },
      }),
      // Last month revenue
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: 'DELIVERED', createdAt: { gte: lastMonthStart, lt: thirtyDaysAgo } },
      }),
    ]);

    // Monthly revenue chart (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const ordersLast7Days = await this.prisma.order.findMany({
      where: { status: 'DELIVERED', createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true, total: true },
    });

    const revenueChart: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      revenueChart[key] = 0;
    }
    ordersLast7Days.forEach(o => {
      const key = o.createdAt.toISOString().split('T')[0];
      if (revenueChart[key] !== undefined) revenueChart[key] += o.total;
    });

    const thisMonthRev = monthlyRevenue._sum.total || 0;
    const lastMonthRev = lastMonthRevenue._sum.total || 0;
    const revTrend = lastMonthRev > 0 ? (((thisMonthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1) + '%' : '+0%';
    const orderTrend = lastMonthOrders > 0 ? (((monthlyOrders - lastMonthOrders) / lastMonthOrders) * 100).toFixed(1) + '%' : '+0%';

    // Role and Status distributions
    const [userRoles, orderStatuses] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: true, where: { deletedAt: null } }),
      this.prisma.order.groupBy({ by: ['status'], _count: true }),
    ]);

    const userRolesMap: Record<string, number> = {};
    userRoles.forEach(r => { userRolesMap[r.role as string] = r._count; });

    const orderStatusesMap: Record<string, number> = {};
    orderStatuses.forEach(s => { orderStatusesMap[s.status as string] = s._count; });

    return {
      stats: {
        totalUsers: { value: totalUsers, trend: '+5%' },
        totalOrders: { value: totalOrders, trend: orderTrend },
        totalRevenue: { value: revenueAgg._sum.total || 0, trend: revTrend },
        pendingOrders: { value: pendingOrders, trend: '-2%' },
        activeVendors: { value: activeVendors, trend: '' },
        pendingDrivers: { value: pendingDrivers, trend: '' },
      },
      recentOrders: recentOrdersList.map(o => ({
        id: o.id.slice(0, 8).toUpperCase(),
        customer: o.customer?.name || 'Unknown',
        vendor: o.restaurant?.name || 'Unknown',
        status: o.status,
        amount: o.total,
        date: o.createdAt,
      })),
      topVendors: topVendors.map(v => ({
        id: v.id,
        name: v.name,
        type: v.vendorType || 'Restaurant',
        rating: v.rating,
        ordersCount: v._count.orders,
        revenue: v.walletBalance,
      })),
      revenueChart: Object.entries(revenueChart).map(([date, revenue]) => ({ date, revenue })),
      distributions: {
        roles: userRolesMap,
        orderStatuses: orderStatusesMap,
      }
    };
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
        driverProfile: { include: { vehicle: true } },
        ownedRestaurants: true,
        ledgers: { orderBy: { createdAt: 'desc' } },
        orders: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
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
      let mappedStatus = status.toUpperCase();
      if (mappedStatus === 'PENDING') mappedStatus = AccountStatus.PENDING_VERIFICATION;
      where.status = mappedStatus;
    } else if (!status || status === 'pending') {
      where.status = AccountStatus.PENDING_VERIFICATION;
    }
    if (vendorType && vendorType !== 'all') {
      where.vendorType = vendorType.toUpperCase();
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

    if (type && type !== 'all') where.vendorType = type.toUpperCase();
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
      let query: any = db.collection('vendor_applications');
      if (status && status !== 'all') {
        query = query.where('status', '==', status.toLowerCase());
      }

      const snapshot = await query.orderBy('createdAt', 'desc').get();
      const applications: any[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data();
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
          createdAt: data.createdAt?.toDate?.() || new Date(),
          rawData: data,
        });
      });

      return applications;
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
  // ORDERS
  // =============================================

  async getAllOrders(filters: { page?: number; limit?: number; status?: string }) {
    const { page = 1, limit = 20, status } = filters;
    const where: any = {};
    if (status && status !== 'all') where.status = status.toUpperCase();

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true, email: true, phone: true } },
          restaurant: { select: { name: true } },
          driver: { include: { user: { select: { name: true } } } },
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

  // =============================================
  // SETTLEMENTS
  // =============================================

  async getSettlements() {
    const [
      vendors, 
      drivers, 
      payouts, 
      activeOrders, 
      activeDriversCount, 
      openRestaurants
    ] = await Promise.all([
      this.prisma.restaurant.findMany({
        where: { status: AccountStatus.ACTIVE },
        select: {
          id: true,
          name: true,
          walletBalance: true,
          vendorType: true,
          _count: { select: { orders: { where: { status: 'DELIVERED' } } } },
        },
      }),
      this.prisma.driverProfile.findMany({
        where: { applicationStatus: 'APPROVED' as any },
        include: {
          user: { select: { id: true, name: true, walletBalance: true } },
        },
      }),
      this.prisma.ledger.findMany({
        where: { type: { in: ['WITHDRAWAL', 'PAYOUT'] } },
        include: { user: { select: { name: true, role: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({
        where: { status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } },
      }),
      this.prisma.driverProfile.count({
        where: { isAvailable: true },
      }),
      this.prisma.restaurant.count({
        where: { isOpen: true },
      })
    ]);

    return {
      stats: {
        activeOrders,
        activeDrivers: activeDriversCount,
        openRestaurants,
      },
      payouts: payouts.map(p => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        type: p.type,
        date: p.createdAt,
        userName: p.user?.name,
        userRole: p.user?.role,
        userEmail: p.user?.email,
      })),
      vendors: vendors.map(v => ({
        id: v.id,
        name: v.name,
        type: v.vendorType,
        balance: v.walletBalance,
        ordersCount: v._count.orders,
      })),
      drivers: drivers.map(d => ({
        id: d.id,
        userId: d.userId,
        name: d.user?.name || 'Unknown',
        balance: d.user?.walletBalance || 0,
      })),
    };
  }

  // =============================================
  // PROCESS PAYOUT
  // =============================================

  async processPayout(dto: { userId: string, amount: number, notes?: string }) {
    const { userId, amount, notes } = dto;
    
    // Find the user to deduct balance
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    
    if (user.walletBalance < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    // Wrap in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { walletBalance: { decrement: amount } },
      });

      // Update restaurant wallet balance if the user is a vendor
      if (user.role === Role.VENDOR) {
        await tx.restaurant.updateMany({
          where: { ownerId: userId },
          data: { walletBalance: { decrement: amount } },
        });
      }

      await tx.ledger.create({
        data: {
          userId,
          type: 'WITHDRAWAL',
          amount: -amount, // Record as negative or positive depending on accounting rules (keeping positive as it represents the withdrawal amount)
          status: 'completed',
          description: notes || 'Admin initiated payout',
          referenceId: `payout_${Date.now()}_${userId.slice(0, 5)}`
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
    return this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...dto },
      update: dto,
    });
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

  // =============================================
  // PENDING APPLICATIONS (combined)
  // =============================================

  async getPendingApplications() {
    const drivers = await this.prisma.driverProfile.findMany({
      where: { applicationStatus: 'PENDING' as any },
      include: { user: true },
    });

    const restaurants = await this.prisma.restaurant.findMany({
      where: { status: AccountStatus.PENDING_VERIFICATION },
      include: { owner: true },
    });

    // Firebase vendor applications
    let firebaseApplications: any[] = [];
    try {
      firebaseApplications = await this.getVendorApplicationsFromFirebase('pending');
    } catch (err) {
      this.logger.warn('Could not fetch Firebase applications: ' + err.message);
    }

    return { drivers, restaurants, firebaseApplications };
  }
}
