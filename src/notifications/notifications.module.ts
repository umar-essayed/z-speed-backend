import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsController, AdminNotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OneSignalService } from './onesignal.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    GatewayModule,
  ],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, OneSignalService],
  exports: [NotificationsService, OneSignalService],
})
export class NotificationsModule {}
