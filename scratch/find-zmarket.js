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

  console.log('--- POSTGRESQL RESTAURANTS ---');
  const pgRestaurants = await prisma.restaurant.findMany({
    where: {
      name: {
        contains: 'z market',
        mode: 'insensitive'
      }
    },
    include: {
      menuSections: {
        include: {
          items: true
        }
      }
    }
  });

  console.log(`Found ${pgRestaurants.length} restaurants matching 'z market' in Postgres:`);
  for (const r of pgRestaurants) {
    console.log(`ID: ${r.id}, FirebaseId: ${r.firebaseId}, Name: ${r.name}, OwnerId: ${r.ownerId}, CreatedAt: ${r.createdAt}`);
    console.log(`  Menu Sections count: ${r.menuSections.length}`);
    for (const sec of r.menuSections) {
      console.log(`    Section: ${sec.name} (id: ${sec.id}), Items count: ${sec.items.length}`);
    }
  }

  console.log('\n--- FIRESTORE RESTAURANTS ---');
  const firestoreSnap = await db.collection('restaurants').get();
  let fsCount = 0;
  firestoreSnap.forEach((doc) => {
    const data = doc.data();
    if (data.name && data.name.toLowerCase().includes('z market')) {
      fsCount++;
      console.log(`DocID: ${doc.id}, Name: ${data.name}, OwnerId: ${data.ownerId}, CreatedAt: ${data.createdAt?.toDate?.() || data.createdAt}`);
    }
  });
  console.log(`Found ${fsCount} documents matching 'z market' in Firestore.`);
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
