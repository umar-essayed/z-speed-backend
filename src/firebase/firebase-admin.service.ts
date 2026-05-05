import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private firestore: admin.firestore.Firestore;

  onModuleInit() {
    try {
      // Look for FIREBASE-KEY.json in the project root or desktop
      const keyPaths = [
        path.join(process.cwd(), 'FIREBASE-KEY.json'),
        path.join(process.cwd(), '..', 'FIREBASE-KEY.json'),
        '/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json',
      ];

      let serviceAccount = null;
      for (const keyPath of keyPaths) {
        if (fs.existsSync(keyPath)) {
          serviceAccount = require(keyPath);
          this.logger.log(`Found Firebase key at ${keyPath}`);
          break;
        }
      }

      if (!serviceAccount) {
        this.logger.warn('FIREBASE-KEY.json not found! Firebase Sync will be disabled.');
        return;
      }

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }

      this.firestore = admin.firestore();
      this.logger.log('Firebase Admin SDK initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
    }
  }

  getFirestore() {
    return this.firestore;
  }
}
