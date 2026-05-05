import * as admin from 'firebase-admin';
import { Injectable, OnModuleInit } from '@nestjs/common';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private firebaseApp: admin.app.App;

  onModuleInit() {
    if (!admin.apps.length) {
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert('/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json'),
      });
      console.log('🔥 Firebase Admin Initialized');
    } else {
      this.firebaseApp = admin.app();
    }
  }

  getFirestore() {
    return admin.firestore();
  }

  getAuth() {
    return admin.auth();
  }
}
