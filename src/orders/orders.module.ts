import { Module } from '@nestjs/common';
import { OrdersController, VendorOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { DisputesModule } from '../disputes/disputes.module';
import { DriversModule } from '../drivers/drivers.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    GatewayModule,
    NotificationsModule,
    PromotionsModule,
    LoyaltyModule,
    DisputesModule,
    DriversModule,
    PaymentsModule,
  ],
  controllers: [OrdersController, VendorOrdersController],
  providers: [OrdersService, OrderStateMachineService],
  exports: [OrdersService, OrderStateMachineService],
})
export class OrdersModule {}
