import * as admin from 'firebase-admin';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private firebaseApp: admin.app.App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    try {
      const serviceAccountVar = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT');
      let credential;

      if (serviceAccountVar) {
        this.logger.log('🔐 Initializing Firebase Admin via Environment Variable');
        // Parse the JSON string from env var
        const serviceAccount = JSON.parse(serviceAccountVar);
        credential = admin.credential.cert(serviceAccount);
      } else {
        this.logger.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not found in env, falling back to local file...');
        const serviceAccountPath = '/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json';
        credential = admin.credential.cert(serviceAccountPath);
      }

      if (!admin.apps.length) {
        this.firebaseApp = admin.initializeApp({
          credential,
        });
        this.logger.log('🔥 Firebase Admin Initialized successfully');
      } else {
        this.firebaseApp = admin.app();
      }
    } catch (error) {
      this.logger.error('❌ Failed to initialize Firebase Admin:', error.message);
    }
  }

  getFirestore() {
    return admin.firestore();
  }

  getAuth() {
    return admin.auth();
  }
}
