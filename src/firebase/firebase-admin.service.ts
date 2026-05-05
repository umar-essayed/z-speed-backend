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

      if (!admin.apps.length) {
        if (serviceAccount) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
          this.logger.log('Initializing Firebase via Environment Variables');
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: process.env.FIREBASE_PROJECT_ID,
              privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            }),
          });
        } else {
          this.logger.warn('FIREBASE credentials not found (No JSON or ENV vars)! Firebase Sync will be disabled.');
          return;
        }
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
