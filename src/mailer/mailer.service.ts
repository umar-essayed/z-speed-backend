import { Injectable, Logger } from '@nestjs/common';
import { MailerService as NestMailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly mailerService: NestMailerService) {}

  async sendWelcomeEmail(to: string, name: string) {
    const html = `<h2>Welcome to Z-Speed, ${name}!</h2><p>We are glad to have you on board.</p>`;
    await this.sendViaMicroservice(to, 'Welcome to Z-Speed!', html);
  }

  async sendPasswordResetEmail(to: string, resetLink: string) {
    const html = `<p>Click the link below to reset your password:</p><a href="${resetLink}">${resetLink}</a>`;
    await this.sendViaMicroservice(to, 'Z-Speed - Password Reset Request', html);
  }

  async sendOtpEmail(to: string, code: string) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Z-Speed Verification Code</title></head>
    <body>
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2>Verification Code</h2>
            <p>Your verification code is:</p>
            <div style="font-size: 24px; font-weight: bold; padding: 10px; background-color: #f4f4f4; border-radius: 5px; display: inline-block;">
                ${code}
            </div>
            <p>This code will expire in 5 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
        </div>
    </body>
    </html>`;

    await this.sendViaMicroservice(to, 'Z-Speed - Verification Code', html);
  }

  private async sendViaMicroservice(to: string, subject: string, html: string) {
    const microserviceUrl = process.env.MAILER_SERVICE_URL;
    const apiKey = process.env.MAILER_SERVICE_API_KEY;

    if (!microserviceUrl || !apiKey) {
      this.logger.warn('External Mailer Service not configured (missing MAILER_SERVICE_URL or MAILER_SERVICE_API_KEY). Fallback not implemented.');
      throw new Error('Mailer Microservice not configured.');
    }

    try {
      const response = await fetch(microserviceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ to, subject, html }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Microservice responded with status ${response.status}: ${errorData}`);
      }

      this.logger.log(`Email successfully sent to ${to} via external service`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to} via external service: ${error.message}`);
      throw error;
    }
  }
}

