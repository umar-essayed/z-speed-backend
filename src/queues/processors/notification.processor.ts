import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { OneSignalService } from '../../notifications/onesignal.service';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly oneSignalService: OneSignalService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('sendPush')
  async handleSendPush(job: Job<{ userId: string; title: string; body: string; data?: any }>) {
    const { userId, title, body, data } = job.data;
    
    try {
      // OneSignal uses the Database User ID (External ID) directly
      await this.oneSignalService.sendToUser(userId, title, body, data);
      this.logger.log(`OneSignal notification sent to user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to send OneSignal push to user ${userId}`, error.stack);
      throw error;
    }
  }

  @Process('sendTopicPush')
  async handleSendTopicPush(job: Job<{ topic: string; title: string; body: string; data?: any }>) {
    const { topic, title, body, data } = job.data;
    try {
      // For topics, we can use segments in OneSignal or just broadcast
      await this.oneSignalService.sendToAll(title, body, data);
      this.logger.log(`OneSignal broadcast notification sent`);
    } catch (error) {
      this.logger.error(`Failed to send OneSignal broadcast`, error.stack);
      throw error;
    }
  }
}
