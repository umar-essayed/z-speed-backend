import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        const client = url 
          ? new Redis(url, {
              tls: url.startsWith('rediss://') ? {} : undefined,
        const redisUrl = config.get('REDIS_URL');
        const logger = new Logger('RedisModule');

        logger.log(`Connecting to Redis at ${redisUrl?.split('@')[1] || 'unknown host'}...`);

        const client = new Redis(redisUrl, {
          maxRetriesPerRequest: 0,
          disableOfflineQueue: false,
          reconnectOnError: (err) => {
            const targetError = 'READONLY';
            if (err.message.includes(targetError)) {
              return true;
            }
            return false;
          },
        });

        client.on('connect', () => logger.log('Successfully connected to Redis.'));
        client.on('error', (err) => logger.error('Redis Client Error:', err.message));

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
