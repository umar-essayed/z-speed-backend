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
              maxRetriesPerRequest: 0,
              enableOfflineQueue: false,
            })
          : new Redis({
              host: config.get<string>('REDIS_HOST', 'localhost'),
              port: config.get<number>('REDIS_PORT', 6379),
              password: config.get<string>('REDIS_PASSWORD'),
              maxRetriesPerRequest: 0,
              enableOfflineQueue: false,
            });

        const loggedErrors = new Set<string>();
        client.on('error', (err) => {
          if (!loggedErrors.has(err.message)) {
            console.warn('Redis Client Error (throttled):', err.message);
            loggedErrors.add(err.message);
            // Clear from set after 1 minute to allow re-logging if problem persists
            setTimeout(() => loggedErrors.delete(err.message), 60000);
          }
        });

        client.on('connect', () => {
          console.log('Successfully connected to Redis');
        });

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
