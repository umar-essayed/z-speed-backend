import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

class InMemoryRedis {
  private store = new Map<string, { value: string; expiry?: number }>();
  private geoStore = new Map<string, Map<string, { lat: number; lng: number }>>();
  private readonly logger = new Logger('InMemoryRedisFallback');

  constructor() {
    this.logger.warn('⚠️ Using In-Memory Redis fallback! Redis data will not persist.');
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiry && Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    let expiry: number | undefined;
    if (mode === 'EX' && duration) {
      expiry = Date.now() + duration * 1000;
    }
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async geoadd(key: string, lng: number, lat: number, member: string): Promise<number> {
    if (!this.geoStore.has(key)) {
      this.geoStore.set(key, new Map());
    }
    this.geoStore.get(key)!.set(member, { lat: Number(lat), lng: Number(lng) });
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    const map = this.geoStore.get(key);
    if (map) {
      return map.delete(member) ? 1 : 0;
    }
    return 0;
  }

  async georadius(
    key: string,
    lng: number,
    lat: number,
    radius: number,
    unit: string,
    ...args: any[]
  ): Promise<any[]> {
    const map = this.geoStore.get(key);
    if (!map) return [];

    const results: any[] = [];
    const rLat = Number(lat);
    const rLng = Number(lng);

    for (const [member, loc] of map.entries()) {
      const dLat = loc.lat - rLat;
      const dLng = loc.lng - rLng;
      const distDeg = Math.sqrt(dLat * dLat + dLng * dLng);
      const distKm = distDeg * 111.0; // Approximate Euclidean distance (1 degree approx 111km)

      if (distKm <= radius) {
        const hasWithDist = args.includes('WITHDIST');
        if (hasWithDist) {
          results.push([member, distKm.toString()]);
        } else {
          results.push(member);
        }
      }
    }

    if (results.length > 0 && Array.isArray(results[0])) {
      results.sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]));
    }

    return results;
  }

  on(event: string, callback: (...args: any[]) => void) {
    return this;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (config: ConfigService) => {
        const logger = new Logger('RedisInitializer');
        const url = config.get<string>('REDIS_URL') || config.get<string>('REDISURL');
        
        const tryConnect = (redisUrlOrOpts: any, label: string): Promise<Redis | null> => {
          return new Promise((resolve) => {
            let client: Redis;
            let resolved = false;

            const handleSuccess = () => {
              if (!resolved) {
                resolved = true;
                logger.log(`✅ Successfully connected to Redis via ${label}`);
                resolve(client);
              }
            };

            const handleFailure = (err: any) => {
              if (!resolved) {
                resolved = true;
                logger.warn(`❌ Connection failed via ${label}: ${err.message}`);
                try {
                  client.disconnect();
                } catch (e) {}
                resolve(null);
              }
            };

            try {
              if (typeof redisUrlOrOpts === 'string') {
                client = new Redis(redisUrlOrOpts, {
                  tls: redisUrlOrOpts.startsWith('rediss://') ? {} : undefined,
                  maxRetriesPerRequest: 0,
                  enableOfflineQueue: false,
                  connectTimeout: 3000,
                });
              } else {
                client = new Redis({
                  ...redisUrlOrOpts,
                  maxRetriesPerRequest: 0,
                  enableOfflineQueue: false,
                  connectTimeout: 3000,
                });
              }

              client.on('ready', handleSuccess);
              client.on('error', handleFailure);
              
              // Fallback timeout in case events are not captured
              setTimeout(() => {
                handleFailure(new Error('Connection timeout (3s)'));
              }, 3500);

            } catch (err) {
              handleFailure(err);
            }
          });
        };

        const createResilientClientProxy = (client: any) => {
          let currentClient = client;
          let useFallback = false;
          const fallback = new InMemoryRedis();

          return new Proxy(currentClient, {
            get(target, prop, receiver) {
              if (useFallback) {
                const val = Reflect.get(fallback, prop);
                return typeof val === 'function' ? val.bind(fallback) : val;
              }

              const value = Reflect.get(currentClient, prop);
              if (typeof value === 'function') {
                return async (...args: any[]) => {
                  if (useFallback) {
                    return value.apply(fallback, args);
                  }
                  try {
                    return await value.apply(currentClient, args);
                  } catch (err: any) {
                    if (
                      err.message &&
                      (err.message.includes('limit exceeded') ||
                        err.message.includes('closed') ||
                        err.message.includes('Connection') ||
                        err.message.includes('ReplyError') ||
                        err.message.includes('max requests'))
                    ) {
                      logger.error(
                        `⚠️ Redis command failed via primary client: ${err.message}. Switching to In-Memory fallback!`,
                      );
                      useFallback = true;
                      try {
                        currentClient.disconnect();
                      } catch (e) {}
                      
                      const fallbackMethod = Reflect.get(fallback, prop);
                      if (typeof fallbackMethod === 'function') {
                        return fallbackMethod.apply(fallback, args);
                      }
                    }
                    throw err;
                  }
                };
              }
              return value;
            },
          });
        };

        // 1. Try REDIS_URL / REDISURL first
        if (url) {
          const client = await tryConnect(url, 'REDISURL');
          if (client) return createResilientClientProxy(client);
        }

        // 2. Try REDIS_HOST / REDISHOST next
        const host = config.get<string>('REDIS_HOST') || config.get<string>('REDISHOST');
        if (host && host !== 'localhost') {
          const client = await tryConnect({
            host,
            port: config.get<number>('REDIS_PORT') || config.get<number>('REDISPORT') || 6379,
            password: config.get<string>('REDIS_PASSWORD') || config.get<string>('REDISPASSWORD'),
          }, 'REDISHOST');
          if (client) return createResilientClientProxy(client);
        }

        // 3. Fall back to local Redis (since local redis-server is active on localhost:6379)
        logger.log('🔄 Attempting local Redis fallback (localhost:6379)...');
        const localClient = await tryConnect({ host: 'localhost', port: 6379 }, 'Local Host Redis');
        if (localClient) return createResilientClientProxy(localClient);

        // 4. Ultimate fallback to In-Memory Redis
        return new InMemoryRedis() as any;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
