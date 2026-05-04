import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every hour — expire old delivery requests.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireDeliveryRequests() {
    const result = await this.prisma.deliveryRequest.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} delivery requests`);
    }
  }

  /**
   * Every Sunday at 02:00 — hard delete soft-deleted records older than 30 days.
   */
  @Cron('0 2 * * 0')
  async cleanupSoftDeleted() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.user.deleteMany({
      where: { deletedAt: { lt: thirtyDaysAgo } },
    });

    this.logger.log(`Cleaned up ${result.count} soft-deleted users`);
  }

  /**
   * Daily at midnight — compute basic daily stats.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async computeDailyStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const [ordersCount, deliveredCount, revenue] = await Promise.all([
      this.prisma.order.count({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.DELIVERED,
          deliveredAt: { gte: yesterdayStart, lt: todayStart },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.DELIVERED,
          deliveredAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { total: true, serviceFee: true },
      }),
    ]);

    this.logger.log(
      `Daily Stats (${yesterdayStart.toISOString().split('T')[0]}): ` +
      `${ordersCount} orders, ${deliveredCount} delivered, ` +
      `${revenue._sum.total ?? 0} revenue`,
    );
  }
}
