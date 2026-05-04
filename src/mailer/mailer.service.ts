import { Injectable, Logger } from '@nestjs/common';
import { MailerService as NestMailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly mailerService: NestMailerService) {}

  async sendWelcomeEmail(to: string, name: string) {
    try {
      await this.mailerService.sendMail({
        to,
        subject: 'Welcome to Z-Speed!',
        template: './welcome',
        context: {
          name,
        },
      });
      this.logger.log(`Welcome email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${to}: ${error.message}`);
    }
  }

  async sendPasswordResetEmail(to: string, resetLink: string) {
    try {
      await this.mailerService.sendMail({
        to,
        subject: 'Z-Speed - Password Reset Request',
        template: './reset-password',
        context: {
          resetLink,
        },
      });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${to}: ${error.message}`);
    }
  }

  async sendOtpEmail(to: string, code: string) {
    // In development mode, we can skip sending real emails if preferred, 
    // but the AuthService already handles this. We keep this as a safety net.
    try {
      await this.mailerService.sendMail({
        to,
        subject: 'Z-Speed - Verification Code',
        template: './otp',
        context: {
          code,
        },
      });
      this.logger.log(`OTP email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${to}: ${error.message}`);
      // Don't rethrow, let the service continue (or return false if needed)
    }
  }
}
