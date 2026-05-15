
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class OneSignalService {
  private readonly logger = new Logger(OneSignalService.name);
  private readonly appId: string | undefined;
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.appId = this.configService.get<string>('ONESIGNAL_APP_ID');
    this.apiKey = this.configService.get<string>('ONESIGNAL_REST_API_KEY');
  }

  async sendToUser(userId: string, title: string, body: string, data: any = {}) {
    if (!this.appId || !this.apiKey) {
      this.logger.warn('OneSignal credentials missing. Notification not sent.');
      return;
    }

    this.logger.log(`OneSignal: Attempting to send push to user ${userId} with title: ${title}`);

    try {
      const response = await axios.post(
        'https://onesignal.com/api/v1/notifications',
        {
          app_id: this.appId,
          include_external_user_ids: [userId],
          headings: { en: title },
          contents: { en: body },
          data: data,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${this.apiKey}`,
          },
        }
      );

      this.logger.log(`OneSignal notification sent to user ${userId}: ${response.data.id}`);
      return response.data;
    } catch (error) {
      const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Error sending OneSignal notification to ${userId}: ${errorDetail}`);
      throw error;
    }
  }

  async sendToAll(title: string, body: string, data: any = {}) {
    try {
      await axios.post(
        'https://onesignal.com/api/v1/notifications',
        {
          app_id: this.appId,
          included_segments: ['All'],
          headings: { en: title },
          contents: { en: body },
          data: data,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${this.apiKey}`,
          },
        }
      );
    } catch (error) {
      this.logger.error(`Error sending OneSignal broadcast: ${error.message}`);
    }
  }
}
