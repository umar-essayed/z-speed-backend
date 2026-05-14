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
            secure: Number(port) === 465,
            auth: {
              user,
              pass: config.get('MAIL_PASS'),
            },
            tls: {
              rejectUnauthorized: false,
            },
            pool: true, // Use pooling
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000,
          },
          defaults: {
            from: `"${config.get('MAIL_FROM_NAME') || 'Z-SPEED'}" <${config.get('MAIL_FROM') || user}>`,
          },
          template: {
            dir: (() => {
              const paths = [
                join(__dirname, 'templates'),
                join(process.cwd(), 'dist', 'mailer', 'templates'),
                join(process.cwd(), 'src', 'mailer', 'templates'),
                join(process.cwd(), 'dist', 'src', 'mailer', 'templates'),
              ];
              const found = paths.find((p) => existsSync(p));
              if (!found) {
                console.error(`[MailerModule] No template directory found! Tried: ${paths.join(', ')}`);
              }
              return found || paths[0];
            })(),
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
