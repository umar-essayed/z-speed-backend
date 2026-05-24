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

async function relinkUser(oldId, newId) {
  console.log(`\n--- RELINKING USER: ${oldId} -> ${newId} ---`);

  // Check if old user exists
  const oldUser = await prisma.user.findUnique({ where: { id: oldId } });
  if (!oldUser) {
    console.log(`⚠️ Old user ${oldId} not found in Postgres.`);
    return;
  }

  // Check if new user already exists
  const newUser = await prisma.user.findUnique({ where: { id: newId } });
  if (newUser) {
    console.log(`⚠️ New user ID ${newId} already exists in Postgres. We will merge them.`);
  }

  try {
    // Try raw SQL update of ID first (which relies on ON UPDATE CASCADE if it exists)
    console.log(`Attempting raw SQL ID update...`);
    await prisma.$executeRawUnsafe(`UPDATE users SET id = '${newId}' WHERE id = '${oldId}'`);
    console.log(`✅ Success! Raw SQL update completed.`);
  } catch (err) {
    console.log(`⚠️ Raw SQL update failed (likely due to foreign key constraints). Switching to manual duplication and transfer strategy...`);
    console.log(`Error detail: ${err.message}`);

    // If new user doesn't exist, create it by copying old user's fields
    if (!newUser) {
      const copyData = { ...oldUser, id: newId };
      // Delete metadata/relation-like fields that prisma generated but cannot write
      delete copyData.createdAt;
      delete copyData.updatedAt;
      
      console.log(`Duplicating user record in Postgres with new ID ${newId}...`);
      await prisma.user.create({
        data: {
          ...copyData,
          id: newId,
          firebaseUid: newId // Set their firebaseUid properly
        }
      });
      console.log(`✅ User duplicated.`);
    }

    // Now, let's find all tables referencing this user ID and update them
    console.log(`Transferring relations...`);

    // 1. Restaurant ownerId
    const restCount = await prisma.restaurant.updateMany({
      where: { ownerId: oldId },
      data: { ownerId: newId }
    });
    console.log(`  Moved ${restCount.count} restaurants.`);

    // 2. Orders customerId
    const orderCount = await prisma.order.updateMany({
      where: { customerId: oldId },
      data: { customerId: newId }
    });
    console.log(`  Moved ${orderCount.count} customer orders.`);

    // 3. Addresses
    const addrCount = await prisma.address.updateMany({
      where: { userId: oldId },
      data: { userId: newId }
    });
    console.log(`  Moved ${addrCount.count} addresses.`);

    // 4. Favorites
    const favCount = await prisma.favorite.updateMany({
      where: { userId: oldId },
      data: { userId: newId }
    });
    console.log(`  Moved ${favCount.count} favorites.`);

    // 5. Driver Profile (if any)
    const driverProfile = await prisma.driverProfile.findUnique({ where: { userId: oldId } });
    if (driverProfile) {
      console.log(`  Found driver profile for old user. Moving...`);
      const existsNew = await prisma.driverProfile.findUnique({ where: { userId: newId } });
      if (!existsNew) {
        await prisma.driverProfile.update({
          where: { id: driverProfile.id },
          data: { userId: newId }
        });
      } else {
        console.log(`  ⚠️ Driver profile already exists for new user. Manual merge required.`);
      }
    }

    // Finally, delete the old user
    console.log(`Deleting old user record ${oldId}...`);
    await prisma.user.delete({ where: { id: oldId } });
    console.log(`✅ Old user record deleted successfully.`);
  }
}

async function main() {
  await initFirebase();
  const db = admin.firestore();

  // Relink Z MARKET owner
  // Old (Postgres): 0a218310-46b4-4e03-b438-cea5860bca63
  // New (Firebase Auth): QNjU1OxisNPq4Ly7TavB
  await relinkUser('0a218310-46b4-4e03-b438-cea5860bca63', 'QNjU1OxisNPq4Ly7TavB');

  // Relink Hassan Soliman
  // Old (Postgres): b39dde69-95a1-4280-b906-9c0750a59e53
  // New (Firebase Auth): XoN9HkIQ1FS2pv8nYwu7hhBIq0P2
  await relinkUser('b39dde69-95a1-4280-b906-9c0750a59e53', 'XoN9HkIQ1FS2pv8nYwu7hhBIq0P2');

  // 3. Make sure the Firestore User Roles are set to VENDOR
  console.log('\n--- FIRESTORE USER ROLE ALIGNMENT ---');
  const vendorUids = ['QNjU1OxisNPq4Ly7TavB', 'XoN9HkIQ1FS2pv8nYwu7hhBIq0P2'];
  for (const uid of vendorUids) {
    const userDocRef = db.collection('users').doc(uid);
    const snap = await userDocRef.get();
    if (snap.exists) {
      await userDocRef.update({
        role: 'vendor',
        status: 'active',
        applicationStatus: 'approved'
      });
      console.log(`✅ Set Firestore user ${uid} role to 'vendor' and status to 'active'`);
    } else {
      // Create user document if it does not exist
      await userDocRef.set({
        id: uid,
        uid: uid,
        role: 'vendor',
        status: 'active',
        type: 'restaurant',
        name: uid === 'QNjU1OxisNPq4Ly7TavB' ? 'Z MARKET' : 'Hassan Soliman',
        email: uid === 'QNjU1OxisNPq4Ly7TavB' ? 'Info@mostafasolimangroup.com' : 'info@mostafasolimangroup.com',
        applicationStatus: 'approved',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`✅ Created missing Firestore user document for ${uid} with role 'vendor'`);
    }
  }

  // 4. Align Firestore Restaurant documents:
  // QNjU1OxisNPq4Ly7TavB must have ownerId = QNjU1OxisNPq4Ly7TavB and status = ACTIVE
  console.log('\n--- FIRESTORE RESTAURANT ALIGNMENT ---');
  const restFbIds = ['QNjU1OxisNPq4Ly7TavB'];
  for (const fbId of restFbIds) {
    const restDocRef = db.collection('restaurants').doc(fbId);
    const snap = await restDocRef.get();
    if (snap.exists) {
      await restDocRef.update({
        ownerId: fbId,
        status: 'ACTIVE', // Web admin and vendor panels look for uppercase ACTIVE
        isActive: true
      });
      console.log(`✅ Updated Firestore restaurant ${fbId} ownerId to ${fbId} and status to ACTIVE`);
    }
  }

  // 5. Force sync the legitimate restaurant details from Postgres to Firestore so everything is 100% aligned
  console.log('\n--- PG TO FIRESTORE SYNC ---');
  // Let's check the restaurant in Postgres first
  const pgRestaurant = await prisma.restaurant.findUnique({
    where: { id: 'ef5b4403-a7ef-4434-84a0-e16d95e0a616' }
  });

  if (pgRestaurant) {
    console.log(`Syncing Z MARKET details from Postgres to Firestore restaurant QNjU1OxisNPq4Ly7TavB...`);
    await db.collection('restaurants').doc('QNjU1OxisNPq4Ly7TavB').set({
      id: 'QNjU1OxisNPq4Ly7TavB',
      ownerId: 'QNjU1OxisNPq4Ly7TavB',
      name: pgRestaurant.name,
      nameAr: pgRestaurant.nameAr || '',
      description: pgRestaurant.description || '',
      descriptionAr: pgRestaurant.descriptionAr || '',
      logoUrl: pgRestaurant.logoUrl || '',
      coverImageUrl: pgRestaurant.coverImageUrl || '',
      status: 'ACTIVE',
      isActive: true,
      isOpen: pgRestaurant.isOpen || false,
      vendorType: 'supermarket',
      address: pgRestaurant.address || '',
      city: pgRestaurant.city || '',
      latitude: pgRestaurant.latitude || 30.0,
      longitude: pgRestaurant.longitude || 31.0,
      deliveryRadiusKm: pgRestaurant.deliveryRadiusKm || 15.0,
      deliveryTimeMin: pgRestaurant.deliveryTimeMin || 30,
      deliveryTimeMax: pgRestaurant.deliveryTimeMax || 45,
      deliveryFee: pgRestaurant.deliveryFee || 0.0,
      minimumOrder: pgRestaurant.minimumOrder || 0.0,
      rating: pgRestaurant.rating || 5.0,
      ratingCount: pgRestaurant.ratingCount || 0,
      updatedAt: new Date()
    }, { merge: true });
    console.log(`✅ Z MARKET fully synced and restored in Firestore!`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    if (admin.apps.length) {
      await Promise.all(admin.apps.map(app => app?.delete().catch(() => {})));
    }
    console.log('\nAll operations finished!');
    process.exit(0);
  });
