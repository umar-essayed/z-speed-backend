import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationQueue: Queue,
  ) {}

  /**
   * Create and persist a notification for a user.
   */
  async createNotification(
    userId: string,
    title: string,
    body: string,
    type?: string,
    data?: any,
  ) {
    const notification = await this.prisma.notification.create({
      data: { userId, title, body, type, data },
    });

    // Offload push notification to BullMQ (Non-blocking)
    this.notificationQueue.add('sendPush', {
      userId,
      title,
      body,
      data,
    }).catch(err => this.logger.error(`Failed to queue push notification for ${userId}: ${err.message}`));

    this.logger.log(`Notification created and queued for ${userId}: ${title}`);
    return notification;
  }

  /**
   * Get paginated notifications for a user.
   */
  async getNotifications(
    userId: string,
    filters: { read?: boolean; page?: number; limit?: number },
  ) {
    const { read, page = 1, limit = 20 } = filters;

    const where: any = { userId };
    if (read !== undefined) where.read = read;

    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);

    return {
      data,
      unreadCount,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Mark a single notification as read.
   */
  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  /**
   * Mark all notifications as read.
   */
  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { marked: result.count };
  }

  /**
   * Delete a notification.
   */
  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    await this.prisma.notification.delete({ where: { id: notificationId } });
    return { message: 'Notification deleted' };
  }

  /**
   * Get unread count.
   */
  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }

  // =============================================
  // HELPER METHODS (used internally by other services)
  // =============================================

  /**
   * Notify vendor about a new order.
   */
  async notifyVendor(restaurantId: string, orderId: string) {
    this.logger.log(`Attempting to notify vendor for restaurant ${restaurantId} and order ${orderId}`);
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { ownerId: true, name: true },
    });
    
    if (restaurant) {
      this.logger.log(`Found restaurant ${restaurant.name} owned by ${restaurant.ownerId}. Creating notification.`);
      await this.createNotification(
        restaurant.ownerId,
        'New Order!',
        `You have a new order at ${restaurant.name}`,
        'order_new',
        { orderId },
      );
    } else {
      this.logger.warn(`No restaurant found with id ${restaurantId} to notify vendor.`);
    }
  }

  /**
   * Notify customer about order status update.
   */
  async notifyCustomer(userId: string, status: string, orderId: string) {
    const statusMessages: Record<string, string> = {
      CONFIRMED: 'Your order has been confirmed!',
      PREPARING: 'Your order is being prepared.',
      READY: 'Your order is ready for pickup!',
      IN_PROGRESS: 'A driver is on the way!',
      OUT_FOR_DELIVERY: 'Your order is out for delivery!',
      DELIVERED: 'Your order has been delivered. Rate your experience!',
      CANCELLED: 'Your order has been cancelled.',
    };

    await this.createNotification(
      userId,
      'Order Update',
      statusMessages[status] || `Order status changed to ${status}`,
      'order_status',
      { orderId, status },
    );
  }

  /**
   * Notify nearby drivers about a delivery request.
   */
  async notifyAvailableDrivers(driverUserIds: string[], orderId: string) {
    await Promise.all(
      driverUserIds.map((userId) =>
        this.createNotification(
          userId,
          'New Delivery Request!',
          'A new delivery request is available near you.',
          'delivery_request',
          { orderId },
        ),
      ),
    );
  }

  /**
   * Notify all admins.
   */
  async notifyAdmins(title: string, body: string, data?: any) {
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) => this.createNotification(a.id, title, body, 'admin', data)),
    );
  }

  /**
   * Notify all SuperAdmins.
   */
  async notifySuperAdmin(payload: { title: string; body: string; data?: any }) {
    const superadmins = await this.prisma.user.findMany({
      where: { role: 'SUPERADMIN' },
      select: { id: true },
    });
    await Promise.all(
      superadmins.map((s) =>
        this.createNotification(s.id, payload.title, payload.body, 'superadmin', payload.data),
      ),
    );
  }

  /**
   * Admin bulk push (to specific users).
   */
  async sendPush(userIds: string[], title: string, body: string, data?: any) {
    await Promise.all(
      userIds.map((id) =>
        this.notificationQueue.add('sendPush', {
          userId: id,
          title,
          body,
          data,
        }),
      ),
    );
    return { queued: userIds.length };
  }
}
