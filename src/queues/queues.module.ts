import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationProcessor } from './processors/notification.processor';
import { EmailProcessor } from './processors/email.processor';
import { CleanupProcessor } from './processors/cleanup.processor';
import { StatsProcessor } from './processors/stats.processor';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (url) {
          return {
            redis: {
              port: parseInt(url.split(':').pop().split('/')[0]), // Extract port from URL if needed, but Bull handles URL better if passed directly
            },
            url: url,
            redisOptions: {
              tls: url.startsWith('rediss://') ? {} : undefined,
              maxRetriesPerRequest: null,
            }
          };
        }
        return {
          redis: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            password: configService.get<string>('REDIS_PASSWORD'),
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: 'notifications' },
      { name: 'emails' },
      { name: 'cleanup' },
      { name: 'stats' },
    ),
    NotificationsModule,
    MailerModule,
  ],
  providers: [
    NotificationProcessor,
    EmailProcessor,
    CleanupProcessor,
    StatsProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}
