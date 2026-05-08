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
              maxRetriesPerRequest: null,
            })
          : new Redis({
              host: config.get<string>('REDIS_HOST', 'localhost'),
              port: config.get<number>('REDIS_PORT', 6379),
              password: config.get<string>('REDIS_PASSWORD'),
              maxRetriesPerRequest: null,
            });

        client.on('error', (err) => {
          console.error('Redis Client Error:', err.message);
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
