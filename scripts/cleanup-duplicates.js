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
      console.log('Initializing Firebase via Env');
      let privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    } else {
      throw new Error('No credentials');
    }
  }
}

async function main() {
  await initFirebase();
  const db = admin.firestore();

  const legitPgId = 'ef5b4403-a7ef-4434-84a0-e16d95e0a616';
  const legitFbId = 'QNjU1OxisNPq4Ly7TavB';

  const duplicatesPgIds = [
    'e86bd6c8-3598-40d3-87ca-43de4ebd26d2',
    'e143b376-93c1-42ce-a7ed-881fe0d640b0'
  ];

  const duplicatesFbIds = [
    'pIq9KF79cPbqNH9fFc6h',
    'aZFGITfhygNX3dhwlWDW'
  ];

  console.log('=== CLEANUP START ===');

  // 1. Update the legitimate Z MARKET to have vendorType = 'supermarket' in Postgres and Firestore
  console.log(`Updating legitimate Z MARKET (${legitPgId}) to vendorType = 'supermarket' in PostgreSQL...`);
  const updatedPg = await prisma.restaurant.update({
    where: { id: legitPgId },
    data: { vendorType: 'supermarket' }
  });
  console.log(`✅ Postgres Z MARKET updated successfully. Name: ${updatedPg.name}, vendorType: ${updatedPg.vendorType}`);

  console.log(`Updating legitimate Z MARKET (${legitFbId}) to vendorType = 'supermarket' in Firestore...`);
  const legitFbRef = db.collection('restaurants').doc(legitFbId);
  const fbDoc = await legitFbRef.get();
  if (fbDoc.exists) {
    await legitFbRef.update({
      vendorType: 'supermarket',
      type: 'supermarket' // Just in case they use type
    });
    console.log(`✅ Firestore restaurant document updated successfully.`);
  } else {
    console.log(`⚠️ Firestore restaurant document ${legitFbId} not found!`);
  }

  // 2. Delete the duplicates from PostgreSQL
  console.log('\n--- Postgres Deletions ---');
  for (const dupId of duplicatesPgIds) {
    const exists = await prisma.restaurant.findUnique({ where: { id: dupId } });
    if (exists) {
      console.log(`Deleting duplicate restaurant ${dupId} from PostgreSQL...`);
      // Since it has no menu sections or items, delete is simple
      await prisma.restaurant.delete({ where: { id: dupId } });
      console.log(`✅ Deleted ${dupId} successfully.`);
    } else {
      console.log(`Restaurant ${dupId} already deleted or does not exist in Postgres.`);
    }
  }

  // 3. Delete the duplicates from Firestore
  console.log('\n--- Firestore Deletions ---');
  for (const dupFbId of duplicatesFbIds) {
    const dupFbRef = db.collection('restaurants').doc(dupFbId);
    const docSnap = await dupFbRef.get();
    if (docSnap.exists) {
      console.log(`Deleting duplicate Firestore restaurant document ${dupFbId}...`);
      await dupFbRef.delete();
      console.log(`✅ Deleted document ${dupFbId} successfully.`);
    } else {
      console.log(`Firestore document ${dupFbId} already deleted or does not exist.`);
    }
  }

  console.log('\n=== CLEANUP COMPLETED SUCCESSFULLY ===');
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
