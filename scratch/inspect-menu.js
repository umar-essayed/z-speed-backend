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

  const pharmacyId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';
  const furnitureId = 'furniture-test-restaurant-id';

  console.log('--- POSTGRESQL SECTIONS ---');
  const pgPharmaSecs = await prisma.menuSection.findMany({ where: { restaurantId: pharmacyId } });
  console.log(`Pharmacy sections in PG count: ${pgPharmaSecs.length}`);
  for (const s of pgPharmaSecs) {
    console.log(`  Section: ${s.name} (ID: ${s.id})`);
  }

  const pgFurnSecs = await prisma.menuSection.findMany({ where: { restaurantId: furnitureId } });
  console.log(`Furniture sections in PG count: ${pgFurnSecs.length}`);
  for (const s of pgFurnSecs) {
    console.log(`  Section: ${s.name} (ID: ${s.id})`);
  }

  console.log('\n--- FIRESTORE SECTIONS ---');
  const pharmaSecsSnap = await db.collection('restaurants').doc(pharmacyId).collection('sections').get();
  console.log(`Pharmacy sections in FS count: ${pharmaSecsSnap.size}`);
  pharmaSecsSnap.forEach(doc => {
    console.log(`  FS Sec ID: ${doc.id}, Name: ${doc.data().name}`);
  });

  const furnSecsSnap = await db.collection('restaurants').doc(furnitureId).collection('sections').get();
  console.log(`Furniture sections in FS count: ${furnSecsSnap.size}`);
  furnSecsSnap.forEach(doc => {
    console.log(`  FS Sec ID: ${doc.id}, Name: ${doc.data().name}`);
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
