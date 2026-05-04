import {
  Module,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { FoodModule } from './food/food.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { DriversModule } from './drivers/drivers.module';
import { WalletModule } from './wallet/wallet.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AdminModule } from './admin/admin.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { GatewayModule } from './gateway/gateway.module';
import { TasksModule } from './tasks/tasks.module';
import { PaymentsModule } from './payments/payments.module';
import { QueuesModule } from './queues/queues.module';
import { CategoriesModule } from './categories/categories.module';
import { PromotionsModule } from './promotions/promotions.module';
import { DisputesModule } from './disputes/disputes.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { HealthModule } from './health/health.module';
import { UploadModule } from './upload/upload.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { RedisModule } from './redis/redis.module';
import { FavoritesModule } from './favorites/favorites.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { SupabaseModule } from './common/supabase/supabase.module';

@Module({
  imports: [
    // Global Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Scheduled Tasks
    ScheduleModule.forRoot(),

    // Core
    PrismaModule,
    SupabaseModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    RestaurantsModule,
    FoodModule,
    CartModule,
    OrdersModule,
    DriversModule,
    WalletModule,
    NotificationsModule,
    ReviewsModule,
    AdminModule,
    SuperadminModule,
    GatewayModule,
    TasksModule,
    PaymentsModule,
    QueuesModule,
    CategoriesModule,
    PromotionsModule,
    DisputesModule,
    LoyaltyModule,
    HealthModule,
    UploadModule,
    RedisModule,
    FavoritesModule,
    OnboardingModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
