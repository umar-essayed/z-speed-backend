import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { NotificationsService } from './src/notifications/notifications.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const notificationsService = app.get(NotificationsService);

  const userId = 'f6a552df-6310-4ae6-8913-9bedb1555825';
  console.log('🚀 Sending test notification to user:', userId);

  try {
    await notificationsService.createNotification(
      userId,
      'Z-SPEED Test',
      'This is a test notification from Antigravity!',
      'test',
      { type: 'test' }
    );
    console.log('✅ Notification task queued successfully!');
  } catch (error) {
    console.error('❌ Failed to send notification:', error);
  }

  await app.close();
}

bootstrap();
