const { PrismaClient } = require('@prisma/client');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
  }
}

async function main() {
  await initFirebase();
  const db = admin.firestore();

  const userIds = [
    '0a218310-46b4-4e03-b438-cea5860bca63',
    'b39dde69-95a1-4280-b906-9c0750a59e53',
    'XoN9HkIQ1FS2pv8nYwu7hhBIq0P2',
    'QNjU1OxisNPq4Ly7TavB'
  ];

  console.log('--- POSTGRESQL USERS ---');
  for (const uid of userIds) {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      include: {
        ownedRestaurants: true
      }
    });
    if (user) {
      console.log(`PG User ID: ${user.id}, Name: ${user.name}, Email: ${user.email}, Role: ${user.role}`);
      console.log(`  Restaurants owned in PG count: ${user.ownedRestaurants.length}`);
      for (const r of user.ownedRestaurants) {
        console.log(`    Restaurant ID: ${r.id}, Name: ${r.name}, FirebaseId: ${r.firebaseId}`);
      }
    } else {
      console.log(`PG User ${uid} does not exist.`);
    }
  }

  console.log('\n--- FIRESTORE USERS ---');
  for (const uid of userIds) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      console.log(`FS User ID: ${uid}, Name: ${data.name}, Email: ${data.email}, Role: ${data.role}, status: ${data.status}`);
    } else {
      console.log(`FS User ${uid} does not exist.`);
    }
  }

  console.log('\n--- FIRESTORE RESTAURANTS ---');
  const snap = await db.collection('restaurants').get();
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`FS RestDocID: ${doc.id}, Name: ${data.name}, OwnerId: ${data.ownerId}, Status: ${data.status}, VendorType: ${data.vendorType}`);
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    if (admin.apps.length) {
      await Promise.all(admin.apps.map(app => app?.delete().catch(() => {})));
    }
    process.exit(0);
  });
