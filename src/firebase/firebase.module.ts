import { Module, Global } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseSyncService } from './firebase-sync.service';
import { GatewayModule } from '../gateway/gateway.module';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [GatewayModule, PrismaModule],
  providers: [FirebaseAdminService, FirebaseSyncService],
  exports: [FirebaseAdminService, FirebaseSyncService],
})
export class FirebaseModule {}
