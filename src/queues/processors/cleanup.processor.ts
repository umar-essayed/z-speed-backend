import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('cleanup')
export class CleanupProcessor {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hard delete soft-deleted records older than 30 days.
   * Runs every Sunday at 02:00 AM.
   */
  @Cron(CronExpression.EVERY_WEEKEND)
  async handleHardDelete() {
    this.logger.log('Starting hard delete of soft-deleted records...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedUsers = await this.prisma.user.deleteMany({
      where: {
        deletedAt: {
          lt: thirtyDaysAgo,
        },
      },
    });

    this.logger.log(`Hard deleted ${deletedUsers.count} users.`);
  }

  /**
   * Clean expired delivery requests.
   * Runs daily at 03:00 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleExpiredRequests() {
    this.logger.log('Cleaning up expired delivery requests...');
    const now = new Date();

    const expired = await this.prisma.deliveryRequest.deleteMany({
      where: {
        OR: [
          { status: 'EXPIRED' },
          { expiresAt: { lt: now } },
        ],
      },
    });

    this.logger.log(`Cleaned up ${expired.count} expired delivery requests.`);
  }

  /**
   * Placeholder for cache cleanup.
   * If using Redis for caching, you can flush expired keys here if not handled by Redis TTL.
   */
  @Process('cleanCache')
  async handleCacheCleanup() {
    this.logger.log('Cache cleanup process triggered.');
    // Redis logic would go here
  }
}
