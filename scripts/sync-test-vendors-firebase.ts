import { PrismaClient, Role, AccountStatus } from '@prisma/client';
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function initFirebase() {
  const keyPaths = [
    path.join(process.cwd(), 'FIREBASE-KEY.json'),
    path.join(process.cwd(), '..', 'FIREBASE-KEY.json'),
    '/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json',
  ];

  let serviceAccount = null;
  for (const keyPath of keyPaths) {
    if (fs.existsSync(keyPath)) {
      serviceAccount = require(keyPath);
      console.log(`Found Firebase key at ${keyPath}`);
      break;
    }
  }

  if (!admin.apps.length) {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      console.log('Initializing Firebase via Environment Variables');
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.substring(1, privateKey.length - 1);
      }
      privateKey = privateKey.replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    } else {
      throw new Error('No Firebase credentials found! Please check FIREBASE-KEY.json or env vars.');
    }
  }
}

const vendorsToSync = [
  {
    email: 'bookstore@zspeedapp.com',
    password: 'ZSpeed@Bookstore55',
    name: 'Z-SPEED Bookstore Owner',
    restaurantId: 'df5a8ac3-b836-4857-af1c-b707326f4a15',
  },
  {
    email: 'pharmacy@zspeedapp.com',
    password: 'ZSpeed@Pharmacy55',
    name: 'Z-SPEED Pharmacy Owner',
    restaurantId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16',
  },
  {
    email: 'furniture_vendor@test.com',
    password: 'password123',
    name: 'Z-Home Furnishings Owner',
    restaurantId: 'furniture-test-restaurant-id',
  },
  {
    email: 'vendor@zspeed.app',
    password: 'password123',
    name: 'Z-SPEED Vendor Owner',
    restaurantId: 'general-test-restaurant-id',
  }
];

async function main() {
  console.log('🔥 Initializing Vendor Firebase Synchronization Script...');
  await initFirebase();
  const db = admin.firestore();

  for (const vendor of vendorsToSync) {
    console.log(`\n----------------------------------------------`);
    console.log(`Processing: ${vendor.email}`);

    // 1. Provision / Sync in Firebase Auth
    let firebaseUid = '';
    try {
      const fbUser = await admin.auth().getUserByEmail(vendor.email);
      firebaseUid = fbUser.uid;
      console.log(`ℹ️ Firebase Auth user already exists: uid = ${firebaseUid}`);
      
      // Update password to ensure it matches
      await admin.auth().updateUser(firebaseUid, {
        password: vendor.password,
        displayName: vendor.name,
      });
      console.log(`✅ Updated password in Firebase Auth successfully`);
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        const fbUser = await admin.auth().createUser({
          email: vendor.email,
          password: vendor.password,
          displayName: vendor.name,
          emailVerified: true,
        });
        firebaseUid = fbUser.uid;
        console.log(`✅ Created new Firebase Auth user: uid = ${firebaseUid}`);
      } else {
        console.error(`❌ Firebase Auth operation failed for ${vendor.email}:`, err);
        continue;
      }
    }

    // 2. Sync to Firestore 'users' Collection (so mobile app login finds the type & status)
    const userRef = db.collection('users').doc(firebaseUid);
    await userRef.set({
      name: vendor.name,
      email: vendor.email,
      type: 'restaurant',
      applicationStatus: 'approved',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`✅ Synchronized Firestore 'users/${firebaseUid}' document`);

    // 3. Update PostgreSQL User database entry
    const dbUser = await prisma.user.upsert({
      where: { email: vendor.email },
      update: {
        role: Role.VENDOR,
        status: AccountStatus.ACTIVE,
        firebaseUid: firebaseUid,
      },
      create: {
        email: vendor.email,
        name: vendor.name,
        role: Role.VENDOR,
        status: AccountStatus.ACTIVE,
        firebaseUid: firebaseUid,
        authProvider: 'email',
        emailVerified: true,
      },
    });
    console.log(`✅ Verified/Updated PostgreSQL User: ${dbUser.email} (ID: ${dbUser.id})`);

    // 4. Update Firestore Restaurant Owner reference
    if (vendor.restaurantId) {
      const restRef = db.collection('restaurants').doc(vendor.restaurantId);
      const doc = await restRef.get();
      if (doc.exists) {
        await restRef.update({
          ownerId: firebaseUid,
        });
        console.log(`✅ Updated Firestore 'restaurants/${vendor.restaurantId}' ownerId to ${firebaseUid}`);
      } else {
        console.log(`⚠️ Firestore 'restaurants/${vendor.restaurantId}' document does not exist yet (run its specific seed script first)`);
      }

      // 5. Update PostgreSQL Restaurant Owner reference
      try {
        const dbRest = await prisma.restaurant.findFirst({
          where: { firebaseId: vendor.restaurantId },
        });
        if (dbRest) {
          await prisma.restaurant.update({
            where: { id: dbRest.id },
            data: { ownerId: dbUser.id },
          });
          console.log(`✅ Updated PostgreSQL Restaurant ownerId reference to User ID: ${dbUser.id}`);
        } else {
          console.log(`⚠️ PostgreSQL Restaurant with firebaseId: ${vendor.restaurantId} not found in DB`);
        }
      } catch (err: any) {
        console.warn(`⚠️ Warning updating PostgreSQL Restaurant ownerId: ${err.message}`);
      }
    }
  }

  console.log(`\n🎉 Firebase and DB Synchronization Completed Successfully! 🎉`);
}

main()
  .catch((e) => {
    console.error('❌ Sync Execution Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
