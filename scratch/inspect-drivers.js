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
      break;
    }
  }

  if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

async function main() {
  await initFirebase();
  const auth = admin.apps.length ? admin.auth() : null;

  console.log('--- FINDING DRIVERS ---');
  const drivers = await prisma.user.findMany({
    where: { role: 'DRIVER' },
    include: { driverProfile: true }
  });

  console.log(`Found ${drivers.length} drivers in PostgreSQL:`);
  for (const d of drivers) {
    console.log(`\nEmail: ${d.email}`);
    console.log(`  Postgres ID: ${d.id}`);
    console.log(`  Supabase ID: ${d.supabaseId}`);
    console.log(`  Firebase Uid: ${d.firebaseUid}`);
    console.log(`  Status: ${d.status}`);

    if (auth) {
      try {
        const fbUser = await auth.getUserByEmail(d.email);
        console.log(`  Firebase Auth: EXISTS (UID: ${fbUser.uid})`);
      } catch (err) {
        console.log(`  Firebase Auth: NOT FOUND (${err.message})`);
      }
    }
  }
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
