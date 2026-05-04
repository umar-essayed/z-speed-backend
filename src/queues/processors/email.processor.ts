import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { MailerService } from '../../mailer/mailer.service';

@Processor('emails')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mailerService: MailerService) {}

  @Process('sendWelcome')
  async handleWelcome(job: Job<{ email: string; name: string }>) {
    this.logger.log(`Processing welcome email for ${job.data.email}`);
    await this.mailerService.sendWelcomeEmail(job.data.email, job.data.name);
  }

  @Process('sendPasswordReset')
  async handlePasswordReset(job: Job<{ email: string; resetLink: string }>) {
    this.logger.log(`Processing password reset email for ${job.data.email}`);
    await this.mailerService.sendPasswordResetEmail(job.data.email, job.data.resetLink);
  }
}
