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

  console.log('--- POSTGRESQL FURNITURE STORES ---');
  const pgStores = await prisma.restaurant.findMany({
    where: {
      OR: [
        { name: { contains: 'home', mode: 'insensitive' } },
        { name: { contains: 'furnish', mode: 'insensitive' } },
        { nameAr: { contains: 'منزل', mode: 'insensitive' } },
        { nameAr: { contains: 'أثاث', mode: 'insensitive' } },
        { nameAr: { contains: 'مفروشات', mode: 'insensitive' } }
      ]
    }
  });
  console.log(`Found ${pgStores.length} furniture stores in Postgres:`);
  for (const p of pgStores) {
    console.log(`ID: ${p.id}, firebaseId: ${p.firebaseId}, ownerId: ${p.ownerId}, name: ${p.name}, vendorType: ${p.vendorType}, status: ${p.status}`);
    const sections = await prisma.menuSection.findMany({ where: { restaurantId: p.id }, include: { items: true } });
    console.log(`  Sections count: ${sections.length}`);
    for (const s of sections) {
      console.log(`    Section: ${s.name} (id: ${s.id}), Items count: ${s.items.length}`);
    }
  }

  console.log('\n--- FIRESTORE FURNITURE STORES ---');
  const fsSnap = await db.collection('restaurants').get();
  let count = 0;
  fsSnap.forEach(doc => {
    const data = doc.data();
    const nameMatch = (data.name && (data.name.toLowerCase().includes('home') || data.name.toLowerCase().includes('furnish'))) || 
                     (data.nameAr && (data.nameAr.includes('منزل') || data.nameAr.includes('أثاث') || data.nameAr.includes('مفروشات')));
    const typeMatch = data.vendorType === 'homeFurnishing' || data.vendorType === 'home_furnishing';
    if (nameMatch || typeMatch) {
      count++;
      console.log(`DocID: ${doc.id}, Name: ${data.name}, NameAr: ${data.nameAr}, OwnerId: ${data.ownerId}, Status: ${data.status}, VendorType: ${data.vendorType}`);
    }
  });
  console.log(`Found ${count} furniture stores in Firestore.`);
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
