import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';
import axios from 'axios';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private jwtClient: JWT;
  private projectId: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.projectId = this.configService.get<string>('FIREBASE_PROJECT_ID') || '';
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    if (this.projectId && privateKey && clientEmail) {
      this.jwtClient = new JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      this.logger.log('FCM Service (REST v1) initialized successfully');
    } else {
      this.logger.warn('Firebase credentials not found. Push notifications will be disabled.');
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.jwtClient) return null;
    const tokens = await this.jwtClient.authorize();
    return tokens.access_token || null;
  }

  async sendToTokens(tokens: string[], title: string, body: string, data: any = {}) {
    if (!this.jwtClient || tokens.length === 0) return;

    // FCM REST v1 send handles one token at a time or use multiple requests
    // For simplicity and robustness, we'll send them in parallel
    const results = await Promise.all(
      tokens.map((token) => this.sendPush(token, title, body, data)),
    );

    const successCount = results.filter((r) => r === true).length;
    const failureCount = results.length - successCount;

    this.logger.log(`FCM Sent: ${successCount} success, ${failureCount} failure`);
    return { successCount, failureCount };
  }

  async sendToTopic(topic: string, title: string, body: string, data: any = {}) {
    if (!this.jwtClient) return;
    return this.sendPush(`/topics/${topic}`, title, body, data);
  }

  private async sendPush(target: string, title: string, body: string, data: any = {}): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken) return false;

      // Convert all data values to strings as required by FCM
      const stringData: Record<string, string> = {};
      for (const key in data) {
        if (data[key] !== undefined && data[key] !== null) {
          stringData[key] = data[key].toString();
        }
      }

      const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
      
      const message: any = {
        notification: { title, body },
        data: stringData,
      };

      // If target starts with /topics/, it's a topic, otherwise it's a token
      if (target.startsWith('/topics/')) {
        message.topic = target.replace('/topics/', '');
      } else {
        message.token = target;
      }

      await axios.post(
        url,
        { message },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Error sending FCM to ${target}: ${error.response?.data?.error?.message || error.message}`,
      );
      return false;
    }
  }
}

