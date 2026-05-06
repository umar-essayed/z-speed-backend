import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FirebaseSyncService } from '../src/orders/firebase-sync.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('ManualSync');
  logger.log('🚀 Starting manual full synchronization from Firebase...');
  
  const app = await NestFactory.createApplicationContext(AppModule);
  const syncService = app.get(FirebaseSyncService);

  try {
    logger.log('--- Phase 1: Syncing Restaurants ---');
    // We access private methods for this manual script
    await (syncService as any).initialSyncRestaurants();

    logger.log('--- Phase 2: Syncing Menu Sections and Items ---');
    await (syncService as any).initialSyncMenu();

    logger.log('✅ FULL SYNC COMPLETED SUCCESSFULLY!');
  } catch (error) {
    logger.error('❌ Sync failed:', error);
  } finally {
    await app.close();
  }
}

bootstrap();
