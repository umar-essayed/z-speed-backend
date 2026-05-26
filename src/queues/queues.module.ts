import { Module, Logger } from '@nestjs/common';
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
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger('BullRedisConfig');
        const url = configService.get<string>('REDIS_URL') || configService.get<string>('REDISURL');
        const host = configService.get<string>('REDIS_HOST') || configService.get<string>('REDISHOST');

        const testRedis = (opts: any, label: string): Promise<boolean> => {
          return new Promise((resolve) => {
            const Redis = require('ioredis');
            let client: any;
            try {
              if (typeof opts === 'string') {
                client = new Redis(opts, {
                  maxRetriesPerRequest: 0,
                  connectTimeout: 2000,
                });
              } else {
                client = new Redis({
                  ...opts,
                  maxRetriesPerRequest: 0,
                  connectTimeout: 2000,
                });
              }
              client.on('ready', () => {
                client.disconnect();
                resolve(true);
              });
              client.on('error', (err: any) => {
                client.disconnect();
                resolve(false);
              });
            } catch (e) {
              resolve(false);
            }
          });
        };

        // 1. Test REDIS_URL first
        if (url) {
          const ok = await testRedis(url, 'REDISURL');
          if (ok) {
            logger.log('✅ Bull using primary REDISURL');
            return {
              url,
              redis: {
                tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
                maxRetriesPerRequest: null,
              },
            };
          }
          logger.warn(`❌ Primary REDISURL connection test failed, trying fallbacks...`);
        }

        // 2. Test REDIS_HOST next
        if (host && host !== 'localhost') {
          const port = configService.get<number>('REDIS_PORT') || configService.get<number>('REDISPORT') || 6379;
          const password = configService.get<string>('REDIS_PASSWORD') || configService.get<string>('REDISPASSWORD');
          const ok = await testRedis({ host, port, password }, 'REDISHOST');
          if (ok) {
            logger.log('✅ Bull using primary REDISHOST');
            return {
              redis: { host, port, password, maxRetriesPerRequest: null },
            };
          }
          logger.warn(`❌ Primary REDISHOST connection test failed, trying local fallback...`);
        }

        // 3. Test local Redis fallback
        const localOk = await testRedis({ host: 'localhost', port: 6379 }, 'Local Host Redis');
        if (localOk) {
          logger.log('🔄 Bull falling back to local Redis (localhost:6379)...');
          return {
            redis: { host: 'localhost', port: 6379, maxRetriesPerRequest: null },
          };
        }

        // 4. Default to localhost:6379
        logger.warn('⚠️ All Redis connection tests failed. Defaulting to local localhost:6379.');
        return {
          redis: { host: 'localhost', port: 6379, maxRetriesPerRequest: null },
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
