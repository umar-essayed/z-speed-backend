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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  await initFirebase();
  const db = admin.firestore();

  const legitPgId = 'ef5b4403-a7ef-4434-84a0-e16d95e0a616';
  const fbDocId = 'QNjU1OxisNPq4Ly7TavB';

  console.log('=== TEST 1: POSTGRESQL -> FIRESTORE SYNC (PRISMA MIDDLEWARE) ===');
  
  // 1. Fetch current name in Firestore
  let doc = await db.collection('restaurants').doc(fbDocId).get();
  console.log(`Initial Firestore name: "${doc.data()?.name}"`);

  // 2. Perform update in Postgres (which should trigger Prisma middleware)
  const testName = 'Z MARKET TEST PREMIUM';
  console.log(`Updating Postgres restaurant name to "${testName}"...`);
  const updatedPg = await prisma.restaurant.update({
    where: { id: legitPgId },
    data: { name: testName }
  });
  console.log(`Postgres update returned: "${updatedPg.name}"`);

  // 3. Wait 4 seconds for middleware background sync to write to Firestore
  console.log('Waiting 4 seconds for Firestore sync...');
  await sleep(4000);

  // 4. Fetch updated name in Firestore
  doc = await db.collection('restaurants').doc(fbDocId).get();
  console.log(`Updated Firestore name: "${doc.data()?.name}"`);

  if (doc.data()?.name === testName) {
    console.log('✅ SUCCESS! Postgres -> Firestore Prisma middleware sync is working perfectly!');
  } else {
    console.log('❌ FAILURE! Firestore name did not update.');
  }

  // 5. Restore original name
  console.log('\nRestoring original name "Z MARKET" in Postgres...');
  await prisma.restaurant.update({
    where: { id: legitPgId },
    data: { name: 'Z MARKET' }
  });
  await sleep(3000);
  doc = await db.collection('restaurants').doc(fbDocId).get();
  console.log(`Final restored Firestore name: "${doc.data()?.name}"`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    if (admin.apps.length) {
      await Promise.all(admin.apps.map(app => app?.delete().catch(() => {})));
    }
    console.log('Done!');
    process.exit(0);
  });
