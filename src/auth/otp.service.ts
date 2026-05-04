import { Injectable, Logger, InternalServerErrorException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import axios from 'axios';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.apiKey = this.config.get<string>('CLOUDOTP_API_KEY') || '';
    this.apiUrl = this.config.get<string>('CLOUDOTP_API_URL', 'https://api.cloudotp.com/v1');
  }

  private get isDevMode(): boolean {
    return !this.apiKey || this.config.get('NODE_ENV') === 'development';
  }

  async sendOtp(identifier: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store in Redis with 5 minutes expiration
    await this.redis.set(`otp:${identifier}`, code, 'EX', 300);

    if (this.isDevMode) {
      this.logger.warn(`[DEV MODE] OTP for ${identifier} is: ${code} (use 123456 as master code)`);
      return code;
    }

    try {
      await axios.post(`${this.apiUrl}/send`, {
        phone: identifier,
        code: code,
        apiKey: this.apiKey,
      });

      return code;
    } catch (error) {
      this.logger.error(`Error sending OTP to ${identifier}: ${error.message}`);
      throw new InternalServerErrorException('Failed to send verification code');
    }
  }

  async verifyOtp(identifier: string, code: string): Promise<boolean> {
    if (this.isDevMode && code === '123456') {
      this.logger.warn(`[DEV MODE] Master code 123456 accepted for ${identifier}`);
      return true;
    }

    const cachedCode = await this.redis.get(`otp:${identifier}`);
    
    if (cachedCode && cachedCode === code) {
      await this.redis.del(`otp:${identifier}`);
      return true;
    }

    if (!this.isDevMode) {
      try {
        const response = await axios.post(`${this.apiUrl}/verify`, {
          phone: identifier,
          code,
          apiKey: this.apiKey,
        });
        return response.data.verified === true;
      } catch (error) {
        this.logger.error(`External OTP verification failed for ${identifier}: ${error.message}`);
      }
    }

    return false;
  }
}
