import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsController, AdminNotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OneSignalService } from './onesignal.service';
import { FcmService } from './fcm.service';
import { GatewayModule } from '../gateway/gateway.module';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    GatewayModule,
    FirebaseModule,
  ],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, OneSignalService, FcmService],
  exports: [NotificationsService, OneSignalService, FcmService],
})
export class NotificationsModule {}
