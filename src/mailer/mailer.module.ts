import { Module, Global } from '@nestjs/common';
import { MailerModule as NestMailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync } from 'fs';
import { MailerService } from './mailer.service';

@Global()
@Module({
  imports: [
    NestMailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get('MAIL_HOST');
        const port = config.get('MAIL_PORT');
        const secure = config.get('MAIL_SECURE') === 'true';
        const user = config.get('MAIL_USER');

        console.log(`[MailerModule] Initializing with Host: ${host}, Port: ${port}, Secure: ${secure}, User: ${user}`);

        return {
          transport: {
            host,
            port: Number(port),
            secure,
            auth: {
              user,
              pass: config.get('MAIL_PASS'),
            },
            requireTLS: port == 587,
            connectionTimeout: 20000, // Increased timeout
            socketTimeout: 20000,
            tls: {
              rejectUnauthorized: false,
              minVersion: 'TLSv1.2',
            },
          },
          defaults: {
            from: `"${config.get('MAIL_FROM_NAME') || 'Z-SPEED'}" <${config.get('MAIL_FROM') || user}>`,
          },
          template: {
            dir: join(process.cwd(), 'dist', 'src', 'mailer', 'templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
    }),
  ],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
