import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { MailerService } from './src/mailer/mailer.service';

async function testBackendMail() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const mailerService = app.get(MailerService);

  const email = 'yijapam424@acanok.com';
  const code = '123456';

  console.log(`--- Testing Backend MailerService ---`);
  console.log(`Sending OTP ${code} to ${email}...`);

  try {
    await mailerService.sendOtpEmail(email, code);
    console.log('✅ Success! Backend MailerService sent the email.');
  } catch (error) {
    console.error('❌ Failed to send email via Backend MailerService:', error.message);
  } finally {
    await app.close();
  }
}

testBackendMail();
