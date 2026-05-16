import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
  ) {}

  async sendToUser(userId: string, title: string, body: string, data: any = {}) {
    this.logger.log(`FCM: Attempting to send push to user ${userId} with title: ${title}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true },
    });

    if (!user || !user.fcmTokens) {
      this.logger.warn(`No FCM tokens found for user ${userId}. Skipping push.`);
      return;
    }

    // Handle tokens (they could be a string, array, or object in our JSON field)
    let tokens: string[] = [];
    if (typeof user.fcmTokens === 'string') {
      tokens = [user.fcmTokens];
    } else if (Array.isArray(user.fcmTokens)) {
      tokens = user.fcmTokens as any as string[];
    } else if (typeof user.fcmTokens === 'object' && user.fcmTokens !== null) {
      // If it's an object mapping deviceId -> token
      tokens = Object.values(user.fcmTokens as Record<string, string>);
    }

    if (tokens.length === 0) {
      this.logger.warn(`User ${userId} has empty fcmTokens field. Skipping push.`);
      return;
    }

    // Remove duplicates and empty strings
    const uniqueTokens = [...new Set(tokens)].filter(t => !!t);

    const message = {
      notification: {
        title,
        body,
      },
      data: this.sanitizeData(data),
      tokens: uniqueTokens,
    };

    try {
      const response = await this.firebaseAdmin.getMessaging().sendEachForMulticast(message);
      
      this.logger.log(`FCM success: ${response.successCount} sent, ${response.failureCount} failed for user ${userId}`);
      
      // Cleanup invalid tokens if any failed
      if (response.failureCount > 0) {
        await this.cleanupInvalidTokens(userId, uniqueTokens, response.responses);
      }

      return response;
    } catch (error) {
      this.logger.error(`Error sending FCM to ${userId}: ${error.message}`);
      throw error;
    }
  }

  async sendToTopic(topic: string, title: string, body: string, data: any = {}) {
    const message = {
      notification: { title, body },
      data: this.sanitizeData(data),
      topic: topic,
    };

    try {
      const response = await this.firebaseAdmin.getMessaging().send(message);
      this.logger.log(`FCM topic message sent to ${topic}: ${response}`);
      return response;
    } catch (error) {
      this.logger.error(`Error sending FCM topic message: ${error.message}`);
    }
  }

  /**
   * Convert all data values to strings (FCM requirement)
   */
  private sanitizeData(data: any): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const key in data) {
      if (data[key] !== undefined && data[key] !== null) {
        sanitized[key] = String(data[key]);
      }
    }
    return sanitized;
  }

  private async cleanupInvalidTokens(userId: string, tokens: string[], responses: any[]) {
    const invalidTokens: string[] = [];
    responses.forEach((res, index) => {
      if (!res.success) {
        const error = res.error;
        if (
          error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(tokens[index]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      this.logger.log(`Cleaning up ${invalidTokens.length} invalid tokens for user ${userId}`);
      
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true },
      });

      if (user && user.fcmTokens) {
        let currentTokens: string[] = [];
        if (Array.isArray(user.fcmTokens)) {
          currentTokens = user.fcmTokens as any as string[];
        } else if (typeof user.fcmTokens === 'object') {
          // If it's an object, we need to find keys to delete. 
          // For simplicity, we assume an array-like structure here for cleanup logic.
          // In production, you might want to handle device-specific keys.
        }

        const filteredTokens = currentTokens.filter(t => !invalidTokens.includes(t));
        
        await this.prisma.user.update({
          where: { id: userId },
          data: { fcmTokens: filteredTokens },
        });
      }
    }
  }
}
