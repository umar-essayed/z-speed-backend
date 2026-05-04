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
  ) {}

  @Process('sendPush')
  async handleSendPush(job: Job<{ userId: string; title: string; body: string; data?: any }>) {
    const { userId, title, body, data } = job.data;
    
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true },
      });

      if (!user) {
        this.logger.warn(`No user found with id ${userId}`);
        return;
      }

      const tokens = user.fcmTokens as unknown as string[];

      if (!tokens || tokens.length === 0) {
        this.logger.warn(`No FCM tokens found for user ${userId}`);
        return;
      }

      await this.fcmService.sendToTokens(tokens, title, body, data);
      this.logger.log(`Push notification sent to user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to send push to user ${userId}`, error.stack);
      throw error;
    }
  }

  @Process('sendTopicPush')
  async handleSendTopicPush(job: Job<{ topic: string; title: string; body: string; data?: any }>) {
    const { topic, title, body, data } = job.data;
    try {
      await this.fcmService.sendToTopic(topic, title, body, data);
      this.logger.log(`Topic push notification sent to ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to send topic push to ${topic}`, error.stack);
      throw error;
    }
  }
}
