import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FirebaseAdminService } from '../src/firebase/firebase-admin.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const firebase = app.get(FirebaseAdminService);
  const db = firebase.getFirestore();

  console.log('--- Inspecting driverProfiles ---');
  const snapshot = await db.collection('driverProfiles').get();
  if (snapshot.empty) {
    console.log('No driver profiles found!');
  } else {
    for (const doc of snapshot.docs) {
      console.log(`Driver ID: ${doc.id}`);
      console.log(`Data:`, doc.data());
    }
  }

  await app.close();
}

bootstrap();
