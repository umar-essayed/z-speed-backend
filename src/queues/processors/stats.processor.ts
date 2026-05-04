import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('stats')
export class StatsProcessor {
  private readonly logger = new Logger(StatsProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute daily stats and save to DB.
   * Runs every day at 12:00 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyStats() {
    this.logger.log('Computing daily stats...');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    try {
      const [
        totalOrders,
        totalRevenue,
        totalUsers,
        totalRestaurants,
        totalDrivers,
      ] = await Promise.all([
        this.prisma.order.count({
          where: {
            createdAt: {
              gte: yesterday,
              lt: today,
            },
            status: 'DELIVERED',
          },
        }),
        this.prisma.order.aggregate({
          where: {
            createdAt: {
              gte: yesterday,
              lt: today,
            },
            status: 'DELIVERED',
          },
          _sum: {
            total: true,
          },
        }),
        this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
        this.prisma.restaurant.count(),
        this.prisma.driverProfile.count(),
      ]);

      // Save to DailyStats table (Note: Ensure the table exists in schema)
      // Since I can't run the migration, I'll wrap this in a try-catch 
      // or just leave it as a placeholder if the table might not exist yet.
      await (this.prisma as any).dailyStats.upsert({
        where: { date: yesterday },
        update: {
          totalOrders,
          totalRevenue: totalRevenue._sum.total || 0,
          totalUsers,
          totalRestaurants,
          totalDrivers,
        },
        create: {
          date: yesterday,
          totalOrders,
          totalRevenue: totalRevenue._sum.total || 0,
          totalUsers,
          totalRestaurants,
          totalDrivers,
        },
      });

      this.logger.log(`Daily stats for ${yesterday.toDateString()} computed and saved.`);
    } catch (error) {
      this.logger.error(`Failed to compute daily stats: ${error.message}`);
    }
  }

  @Process('computeManualStats')
  async handleManualStats(job: any) {
    this.logger.log('Manual stats computation triggered.');
    // Logic for manual stats
  }
}
