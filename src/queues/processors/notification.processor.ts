import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { FcmService } from '../../notifications/fcm.service';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly fcmService: FcmService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('🚀 NotificationProcessor (FCM) initialized and ready to process jobs');
  }

  @Process('sendPush')
  async handleSendPush(job: Job<{ userId: string; title: string; body: string; data?: any }>) {
    const { userId, title, body, data } = job.data;
    this.logger.log(`Processing FCM push notification for user: ${userId}`);
    
    try {
      await this.fcmService.sendToUser(userId, title, body, data);
      this.logger.log(`FCM notification sent to user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to send FCM push to user ${userId}`, error.stack);
      throw error;
    }
  }

  @Process('sendTopicPush')
  async handleSendTopicPush(job: Job<{ topic: string; title: string; body: string; data?: any }>) {
    const { topic, title, body, data } = job.data;
    try {
      await this.fcmService.sendToTopic(topic, title, body, data);
      this.logger.log(`FCM topic notification sent to ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to send FCM topic push`, error.stack);
      throw error;
    }
  }
}
