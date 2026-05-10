import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsController, AdminNotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OneSignalService } from './onesignal.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, OneSignalService],
  exports: [NotificationsService, OneSignalService],
})
export class NotificationsModule {}
