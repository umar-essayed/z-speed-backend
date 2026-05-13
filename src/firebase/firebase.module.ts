import { Module, Global } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseSyncService } from './firebase-sync.service';

@Global()
@Module({
  providers: [FirebaseAdminService, FirebaseSyncService],
  exports: [FirebaseAdminService, FirebaseSyncService],
})
export class FirebaseModule {}

