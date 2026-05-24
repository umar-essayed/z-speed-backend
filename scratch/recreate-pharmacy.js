const { PrismaClient } = require('@prisma/client');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
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
  const auth = admin.auth();

  const email = 'pharmacy@zspeedapp.com';
  const pharmacyRestaurantId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';

  console.log(`=== STARTING DEEP PURGE FOR ${email} ===`);

  // 1. Find the user in PostgreSQL
  const user = await prisma.user.findFirst({
    where: { email }
  });

  if (user) {
    console.log(`Found PostgreSQL user ID: ${user.id}`);
    const userId = user.id;

    // Delete in dependent order
    console.log('1. Deleting user cart items, favorites, and orders...');
    await prisma.cartItem.deleteMany({ where: { cart: { customerId: userId } } }).catch(err => console.log(`   (CartItem): ${err.message}`));
    await prisma.cart.deleteMany({ where: { customerId: userId } }).catch(err => console.log(`   (Cart): ${err.message}`));
    await prisma.favorite.deleteMany({ where: { userId } }).catch(err => console.log(`   (Favorite): ${err.message}`));
    await prisma.orderItem.deleteMany({ where: { order: { customerId: userId } } }).catch(err => console.log(`   (OrderItem): ${err.message}`));
    await prisma.order.deleteMany({ where: { customerId: userId } }).catch(err => console.log(`   (Order): ${err.message}`));
    await prisma.driverProfile.deleteMany({ where: { userId } }).catch(err => console.log(`   (DriverProfile): ${err.message}`));

    // Find owned restaurants
    const ownedRestaurants = await prisma.restaurant.findMany({
      where: { ownerId: userId }
    });

    for (const r of ownedRestaurants) {
      console.log(`2. Purging owned restaurant ${r.name} (ID: ${r.id})...`);
      // Delete restaurant menu dependencies
      const sections = await prisma.menuSection.findMany({ where: { restaurantId: r.id } });
      const sectionIds = sections.map(s => s.id);

      console.log('   Purging menu section items, variants, order items...');
      await prisma.foodItemVariant.deleteMany({ where: { foodItem: { sectionId: { in: sectionIds } } } });
      await prisma.foodItem.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await prisma.orderItem.deleteMany({ where: { order: { restaurantId: r.id } } });
      await prisma.order.deleteMany({ where: { restaurantId: r.id } });
      await prisma.promotionUsage.deleteMany({ where: { promotion: { restaurantId: r.id } } });
      await prisma.promotion.deleteMany({ where: { restaurantId: r.id } });
      await prisma.review.deleteMany({ where: { restaurantId: r.id } });
      await prisma.menuSection.deleteMany({ where: { restaurantId: r.id } });
      await prisma.restaurant.delete({ where: { id: r.id } });
    }

    // Purge specific hardcoded pharmacy ID just in case it was detached
    console.log(`3. Purging target pharmacy restaurant ${pharmacyRestaurantId} if remaining...`);
    const targetSections = await prisma.menuSection.findMany({ where: { restaurantId: pharmacyRestaurantId } });
    const targetSecIds = targetSections.map(s => s.id);
    await prisma.foodItemVariant.deleteMany({ where: { foodItem: { sectionId: { in: targetSecIds } } } });
    await prisma.foodItem.deleteMany({ where: { sectionId: { in: targetSecIds } } });
    await prisma.orderItem.deleteMany({ where: { order: { restaurantId: pharmacyRestaurantId } } });
    await prisma.order.deleteMany({ where: { restaurantId: pharmacyRestaurantId } });
    await prisma.promotionUsage.deleteMany({ where: { promotion: { restaurantId: pharmacyRestaurantId } } });
    await prisma.promotion.deleteMany({ where: { restaurantId: pharmacyRestaurantId } });
    await prisma.review.deleteMany({ where: { restaurantId: pharmacyRestaurantId } });
    await prisma.menuSection.deleteMany({ where: { restaurantId: pharmacyRestaurantId } });
    await prisma.restaurant.deleteMany({ where: { id: pharmacyRestaurantId } });

    // Finally delete the user from PostgreSQL
    console.log('4. Deleting user from PostgreSQL...');
    await prisma.user.delete({ where: { id: userId } });
    console.log('PostgreSQL user purged successfully.');

    // 2. Delete from Supabase Auth
    if (user.supabaseId) {
      console.log(`5. Deleting user from Supabase Auth (Supabase ID: ${user.supabaseId})...`);
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { error } = await supabase.auth.admin.deleteUser(user.supabaseId);
        if (error) {
          console.error(`Error deleting Supabase user: ${error.message}`);
        } else {
          console.log('Supabase Auth user purged successfully.');
        }
      } else {
        console.log('Missing Supabase credentials, skipping Supabase Auth deletion.');
      }
    }
  } else {
    console.log('PostgreSQL user not found, checking raw pharmacy ID...');
    await prisma.restaurant.deleteMany({ where: { id: pharmacyRestaurantId } }).catch(() => {});
  }

  // 3. Delete from Firebase Auth
  console.log(`6. Deleting user ${email} from Firebase Auth...`);
  let fbUserToDelete = null;
  try {
    fbUserToDelete = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') console.error(err);
  }

  if (fbUserToDelete) {
    console.log(`Found Firebase User: ${fbUserToDelete.uid}. Deleting...`);
    await auth.deleteUser(fbUserToDelete.uid);
    console.log('Firebase Auth user purged successfully.');
  } else {
    console.log('Firebase Auth user not found.');
  }

  // 4. Delete from Firestore
  console.log('7. Purging Firestore documents...');
  if (fbUserToDelete) {
    await db.collection('users').doc(fbUserToDelete.uid).delete().catch(() => {});
  }
  // Delete the restaurant and subcollections from Firestore
  const legitPhRef = db.collection('restaurants').doc(pharmacyRestaurantId);
  const sectionsSnap = await legitPhRef.collection('menuSections').get();
  for (const sDoc of sectionsSnap.docs) {
    const itemsSnap = await sDoc.ref.collection('items').get();
    for (const iDoc of itemsSnap.docs) {
      await iDoc.ref.delete();
    }
    await sDoc.ref.delete();
  }
  const oldSectionsSnap = await legitPhRef.collection('sections').get();
  for (const sDoc of oldSectionsSnap.docs) {
    const itemsSnap = await sDoc.ref.collection('items').get();
    for (const iDoc of itemsSnap.docs) {
      await iDoc.ref.delete();
    }
    await sDoc.ref.delete();
  }
  await legitPhRef.delete();
  console.log('Firestore pharmacy restaurant and collections purged successfully.');

  console.log('\n=== PURGE COMPLETED successfully! ===');

  console.log('\n=== CREATING NEW PHARMACY ACCOUNT ON FIREBASE ONLY ===');
  
  // 1. Create User in Firebase Auth
  const defaultPassword = '12345678';
  const newFbUser = await auth.createUser({
    email,
    password: defaultPassword,
    displayName: 'Z-SPEED Premium Pharmacy',
  });
  console.log(`1. Created new Firebase Auth user with UID: ${newFbUser.uid}`);

  // Set initial claims for custom vendor
  await auth.setCustomUserClaims(newFbUser.uid, {
    role: 'VENDOR',
  });
  console.log('2. Set VENDOR custom user claims on Firebase user.');

  // 2. Create Restaurant in Firestore
  const newRestRef = db.collection('restaurants').doc(pharmacyRestaurantId);
  await newRestRef.set({
    id: pharmacyRestaurantId,
    ownerId: newFbUser.uid, // Point directly to the new Firebase UID!
    name: 'Z-SPEED Premium Pharmacy',
    nameAr: 'صيدلية زد سبيد الممتازة',
    status: 'ACTIVE',
    vendorType: 'pharmacy',
    isActive: true,
    rating: 5.0,
    deliveryFee: 15.0,
    cuisineTypes: ['Medicines'],
    image: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600&h=400&fit=crop',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  console.log(`3. Created pharmacy restaurant document ${pharmacyRestaurantId} in Firestore.`);

  // 3. Create User doc in Firestore
  await db.collection('users').doc(newFbUser.uid).set({
    id: newFbUser.uid,
    email,
    name: 'Z-SPEED Premium Pharmacy',
    role: 'VENDOR',
    type: 'restaurant',
    updatedAt: new Date()
  });
  console.log(`4. Created user document ${newFbUser.uid} in Firestore.`);

  console.log('\n=== NEW PHARMACY SUCCESSFULLY SEEDED ON FIREBASE ONLY! ===');
  console.log(`Email: ${email}`);
  console.log(`Password: ${defaultPassword}`);
  console.log(`Firestore Restaurant ID: ${pharmacyRestaurantId}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
