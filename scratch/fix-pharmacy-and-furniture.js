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

async function safelyDeleteRestaurant(restaurantId) {
  console.log(`\n--- Safely deleting Restaurant: \${restaurantId} ---`);
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) {
    console.log(`Restaurant \${restaurantId} does not exist. Skipping deletion.`);
    return;
  }

  // 1. Find all orders belonging to this restaurant
  const orders = await prisma.order.findMany({ where: { restaurantId } });
  const orderIds = orders.map(o => o.id);
  console.log(`Found \${orderIds.length} orders to delete.`);

  if (orderIds.length > 0) {
    // 1a. Set orderId = null in Ledger for these orders
    await prisma.ledger.updateMany({
      where: { orderId: { in: orderIds } },
      data: { orderId: null }
    });
    console.log(`- Set orderId = null in Ledger for these orders`);

    // 1b. Delete all OrderItem records explicitly
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: orderIds } }
    });
    console.log(`- Deleted order items for these orders`);

    // 1c. Delete the orders
    await prisma.order.deleteMany({
      where: { id: { in: orderIds } }
    });
    console.log(`- Deleted orders`);
  }

  // 2. Find all menu sections and their items
  const sections = await prisma.menuSection.findMany({ where: { restaurantId } });
  const sectionIds = sections.map(s => s.id);
  
  const items = await prisma.foodItem.findMany({
    where: { sectionId: { in: sectionIds } }
  });
  const itemIds = items.map(i => i.id);

  if (itemIds.length > 0) {
    // 2a. Delete all cart items referencing these food items
    await prisma.cartItem.deleteMany({
      where: { foodItemId: { in: itemIds } }
    });
    console.log(`- Deleted cart items referencing \${itemIds.length} food items`);

    // 2b. Delete food item variants
    await prisma.foodItemVariant.deleteMany({
      where: { foodItemId: { in: itemIds } }
    });
    console.log(`- Deleted food item variants`);

    // 2c. Delete the food items
    await prisma.foodItem.deleteMany({
      where: { id: { in: itemIds } }
    });
    console.log(`- Deleted food items`);
  }

  // 3. Delete the menu sections
  if (sectionIds.length > 0) {
    await prisma.menuSection.deleteMany({
      where: { id: { in: sectionIds } }
    });
    console.log(`- Deleted menu sections`);
  }

  // 4. Update cart restaurant reference
  await prisma.cart.updateMany({
    where: { restaurantId },
    data: { restaurantId: null }
  });
  console.log(`- Updated cart restaurant references to null`);

  // 5. Delete favorites referencing this restaurant
  await prisma.favorite.deleteMany({
    where: { restaurantId }
  });
  console.log(`- Deleted favorites referencing restaurant`);

  // 6. Delete promotions referencing this restaurant
  await prisma.promotion.deleteMany({
    where: { restaurantId }
  });
  console.log(`- Deleted promotions referencing restaurant`);

  // 7. Delete reviews referencing this restaurant
  await prisma.review.deleteMany({
    where: { restaurantId }
  });
  console.log(`- Deleted reviews referencing restaurant`);

  // 8. Delete prescription requests referencing this restaurant
  try {
    await prisma.prescriptionRequest.deleteMany({
      where: { restaurantId }
    });
    console.log(`- Deleted prescription requests referencing restaurant`);
  } catch (err) {
    console.log(`- Skipping prescription requests deletion`);
  }

  // 9. Delete RestaurantCuisine and RestaurantCategory links
  await prisma.restaurantCuisine.deleteMany({
    where: { restaurantId }
  });
  await prisma.restaurantCategory.deleteMany({
    where: { restaurantId }
  });

  // 10. Delete the restaurant itself
  await prisma.restaurant.delete({
    where: { id: restaurantId }
  });
  console.log(`✅ Successfully deleted restaurant: \${restaurantId}`);
}

async function main() {
  await initFirebase();
  const db = admin.firestore();

  console.log('=== CLEANING AND ALIGNING PHARMACY & FURNITURE ACCOUNTS ===');

  // =============================================
  // 1. SURGICAL MERGE FOR PHARMACY
  // =============================================
  // Active User in Firestore: QPBzlOR8WKb8APfi8iBflXHh2ml2
  // We want to delete the duplicate user fa37afd9-674b-4927-b32d-63853131e601 in PG
  console.log('\n--- Merging Pharmacy User Accounts in Postgres ---');
  
  // Make sure the active user 4806e323-a73a-4102-be25-fcc54d158630 has its ID updated to QPBzlOR8WKb8APfi8iBflXHh2ml2
  // Let's delete conflict users first
  const conflictUser = await prisma.user.findUnique({ where: { id: 'fa37afd9-674b-4927-b32d-63853131e601' } });
  if (conflictUser) {
    // Delete any restaurants owned by conflict user first
    const ownedRests = await prisma.restaurant.findMany({ where: { ownerId: 'fa37afd9-674b-4927-b32d-63853131e601' } });
    for (const r of ownedRests) {
      await safelyDeleteRestaurant(r.id);
    }
    await prisma.user.delete({ where: { id: 'fa37afd9-674b-4927-b32d-63853131e601' } });
    console.log('✅ Deleted conflict user fa37afd9-674b-4927-b32d-63853131e601 from Postgres');
  }

  // Now change user ID 4806e323-a73a-4102-be25-fcc54d158630 to QPBzlOR8WKb8APfi8iBflXHh2ml2
  const activeUser = await prisma.user.findUnique({ where: { id: '4806e323-a73a-4102-be25-fcc54d158630' } });
  if (activeUser) {
    console.log('Relinking pharmacy owner user ID...');
    try {
      await prisma.$executeRawUnsafe(`UPDATE users SET id = 'QPBzlOR8WKb8APfi8iBflXHh2ml2', "firebaseUid" = 'QPBzlOR8WKb8APfi8iBflXHh2ml2' WHERE id = '4806e323-a73a-4102-be25-fcc54d158630'`);
      console.log('✅ Updated user ID to QPBzlOR8WKb8APfi8iBflXHh2ml2');
    } catch (err) {
      console.log('⚠️ Raw SQL ID update failed. Creating new and copying...');
      const existsNew = await prisma.user.findUnique({ where: { id: 'QPBzlOR8WKb8APfi8iBflXHh2ml2' } });
      if (!existsNew) {
        const copy = { ...activeUser, id: 'QPBzlOR8WKb8APfi8iBflXHh2ml2', firebaseUid: 'QPBzlOR8WKb8APfi8iBflXHh2ml2' };
        delete copy.createdAt;
        delete copy.updatedAt;
        await prisma.user.create({ data: copy });
      }
      await prisma.restaurant.updateMany({ where: { ownerId: '4806e323-a73a-4102-be25-fcc54d158630' }, data: { ownerId: 'QPBzlOR8WKb8APfi8iBflXHh2ml2' } });
      await prisma.user.delete({ where: { id: '4806e323-a73a-4102-be25-fcc54d158630' } });
      console.log('✅ Manual copy and transfer completed.');
    }
  }

  // Delete duplicate pharmacy d68a1606-d50d-410c-bf4a-54b2579e2c64 from Postgres
  await safelyDeleteRestaurant('d68a1606-d50d-410c-bf4a-54b2579e2c64');

  // Delete duplicate pharmacy document QPBzlOR8WKb8APfi8iBflXHh2ml2 in Firestore
  const fsDupPhRef = db.collection('restaurants').doc('QPBzlOR8WKb8APfi8iBflXHh2ml2');
  await fsDupPhRef.delete();
  console.log('✅ Deleted duplicate Firestore document QPBzlOR8WKb8APfi8iBflXHh2ml2');

  // Set the active pharmacy ef6a8ac3-b836-4857-af1c-b707326f4a16 details and owner in Postgres
  // If ef6a8ac3-b836-4857-af1c-b707326f4a16 doesn't exist in Postgres, create it!
  const pgLegitPharma = await prisma.restaurant.findUnique({ where: { id: 'ef6a8ac3-b836-4857-af1c-b707326f4a16' } });
  if (pgLegitPharma) {
    await prisma.restaurant.update({
      where: { id: 'ef6a8ac3-b836-4857-af1c-b707326f4a16' },
      data: {
        firebaseId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16',
        ownerId: 'QPBzlOR8WKb8APfi8iBflXHh2ml2',
        name: 'Z-SPEED Premium Pharmacy',
        nameAr: 'صيدلية زد سبيد الفاخرة',
        vendorType: 'pharmacy',
        status: 'ACTIVE',
        isActive: true,
        isOpen: true
      }
    });
  } else {
    await prisma.restaurant.create({
      data: {
        id: 'ef6a8ac3-b836-4857-af1c-b707326f4a16',
        firebaseId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16',
        ownerId: 'QPBzlOR8WKb8APfi8iBflXHh2ml2',
        name: 'Z-SPEED Premium Pharmacy',
        nameAr: 'صيدلية زد سبيد الفاخرة',
        vendorType: 'pharmacy',
        status: 'ACTIVE',
        isActive: true,
        isOpen: true
      }
    });
  }
  console.log('✅ Aligned active pharmacy in Postgres');

  // Force sync Firestore active pharmacy document ef6a8ac3-b836-4857-af1c-b707326f4a16
  const fsLegitPhRef = db.collection('restaurants').doc('ef6a8ac3-b836-4857-af1c-b707326f4a16');
  await fsLegitPhRef.set({
    id: 'ef6a8ac3-b836-4857-af1c-b707326f4a16',
    ownerId: 'QPBzlOR8WKb8APfi8iBflXHh2ml2',
    name: 'Z-SPEED Premium Pharmacy',
    nameAr: 'صيدلية زد سبيد الفاخرة',
    vendorType: 'pharmacy',
    status: 'ACTIVE',
    isActive: true,
    isOpen: true
  }, { merge: true });
  console.log('✅ Aligned active pharmacy in Firestore');


  // =============================================
  // 2. SURGICAL MERGE FOR FURNITURE
  // =============================================
  console.log('\n--- Merging Furniture User Accounts in Postgres ---');
  // Old PG ID: fa51ed5e-2711-4431-9ec8-483e02066aba
  // New FB ID: oy2obDfLswReNk2fgBPzPiL7A593
  const activeFurnUser = await prisma.user.findUnique({ where: { id: 'fa51ed5e-2711-4431-9ec8-483e02066aba' } });
  if (activeFurnUser) {
    try {
      await prisma.$executeRawUnsafe(`UPDATE users SET id = 'oy2obDfLswReNk2fgBPzPiL7A593', "firebaseUid" = 'oy2obDfLswReNk2fgBPzPiL7A593' WHERE id = 'fa51ed5e-2711-4431-9ec8-483e02066aba'`);
      console.log('✅ Updated furniture user ID to oy2obDfLswReNk2fgBPzPiL7A593');
    } catch (err) {
      console.log('⚠️ Raw SQL ID update failed. Creating new and copying...');
      const existsNew = await prisma.user.findUnique({ where: { id: 'oy2obDfLswReNk2fgBPzPiL7A593' } });
      if (!existsNew) {
        const copy = { ...activeFurnUser, id: 'oy2obDfLswReNk2fgBPzPiL7A593', firebaseUid: 'oy2obDfLswReNk2fgBPzPiL7A593' };
        delete copy.createdAt;
        delete copy.updatedAt;
        await prisma.user.create({ data: copy });
      }
      await prisma.restaurant.updateMany({ where: { ownerId: 'fa51ed5e-2711-4431-9ec8-483e02066aba' }, data: { ownerId: 'oy2obDfLswReNk2fgBPzPiL7A593' } });
      await prisma.user.delete({ where: { id: 'fa51ed5e-2711-4431-9ec8-483e02066aba' } });
      console.log('✅ Manual copy and transfer completed.');
    }
  }

  // Delete duplicate furniture 2285d449-5304-46dc-b27f-1c1f2f27ab58 from Postgres
  await safelyDeleteRestaurant('2285d449-5304-46dc-b27f-1c1f2f27ab58');

  // Align active furniture store in Postgres
  await prisma.restaurant.update({
    where: { id: 'furniture-test-restaurant-id' },
    data: {
      ownerId: 'oy2obDfLswReNk2fgBPzPiL7A593',
      name: 'Z-Home Furnishings & Bedding',
      nameAr: 'زد هوم للأثاث والمفروشات',
      vendorType: 'homeFurnishing',
      status: 'ACTIVE',
      isActive: true,
      isOpen: true
    }
  });
  console.log('✅ Aligned active furniture in Postgres');

  // Align active furniture store in Firestore
  const fsLegitFuRef = db.collection('restaurants').doc('furniture-test-restaurant-id');
  await fsLegitFuRef.set({
    id: 'furniture-test-restaurant-id',
    ownerId: 'oy2obDfLswReNk2fgBPzPiL7A593',
    name: 'Z-Home Furnishings & Bedding',
    nameAr: 'زد هوم للأثاث والمفروشات',
    vendorType: 'homeFurnishing',
    status: 'ACTIVE',
    isActive: true,
    isOpen: true
  }, { merge: true });
  console.log('✅ Aligned active furniture in Firestore');


  // =============================================
  // 3. SEED PRODUCTS & VARIANTS
  // =============================================
  console.log('\n--- Seeding Pharmacy active menu with Variants ---');

  // Pre-cleanup Pharmacy Menu Sections & Items
  console.log('Cleaning all existing pharmacy sections and items to avoid duplicates...');
  const existingPhSecs = await prisma.menuSection.findMany({ where: { restaurantId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16' } });
  for (const s of existingPhSecs) {
    await prisma.foodItemVariant.deleteMany({ where: { foodItem: { sectionId: s.id } } });
    await prisma.foodItem.deleteMany({ where: { sectionId: s.id } });
  }
  await prisma.menuSection.deleteMany({ where: { restaurantId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16' } });

  // Delete from Firestore sections
  const fsPhSections = await fsLegitPhRef.collection('sections').get();
  for (const doc of fsPhSections.docs) {
    const fsPhItems = await doc.ref.collection('items').get();
    for (const itemDoc of fsPhItems.docs) {
      await itemDoc.ref.delete();
    }
    await doc.ref.delete();
  }
  console.log('✅ Cleaned existing pharmacy menu items');

  const pharmaSecId = 'pharmacy-sec-1';

  // Postgres MenuSection
  await prisma.menuSection.upsert({
    where: { id: pharmaSecId },
    update: { name: 'Medicines', nameAr: 'الأدوية العلاجية', isActive: true, restaurantId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16' },
    create: { id: pharmaSecId, restaurantId: 'ef6a8ac3-b836-4857-af1c-b707326f4a16', name: 'Medicines', nameAr: 'الأدوية العلاجية', isActive: true, sortOrder: 0 }
  });
  // Firestore MenuSection
  await fsLegitPhRef.collection('sections').doc(pharmaSecId).set({ id: pharmaSecId, name: 'Medicines', nameAr: 'الأدوية العلاجية', isActive: true, sortOrder: 0 });

  // Postgres & Firestore Panadol
  const pharmaItemId = 'panadol-item-id';
  await prisma.foodItem.upsert({
    where: { id: pharmaItemId },
    update: {
      name: 'Panadol Joint / بنادول للمفاصل',
      nameAr: 'بنادول للمفاصل',
      price: 120.0,
      hasFractions: true,
      fractionUnitName: 'Strip',
      fractionUnitNameAr: 'شريط',
      unitsPerParent: 3,
      fractionPrice: 40.0,
      isAvailable: true,
      stockQuantity: 50,
      sectionId: pharmaSecId
    },
    create: {
      id: pharmaItemId,
      sectionId: pharmaSecId,
      name: 'Panadol Joint / بنادول للمفاصل',
      nameAr: 'بنادول للمفاصل',
      price: 120.0,
      hasFractions: true,
      fractionUnitName: 'Strip',
      fractionUnitNameAr: 'شريط',
      unitsPerParent: 3,
      fractionPrice: 40.0,
      isAvailable: true,
      stockQuantity: 50
    }
  });

  const panadolBoxVarId = 'panadol-box-var-id';
  const panadolStripVarId = 'panadol-strip-var-id';

  await prisma.foodItemVariant.upsert({
    where: { id: panadolBoxVarId },
    update: { price: 120.0, stockQuantity: 50, isFraction: false, fractionMultiplier: 3 },
    create: { id: panadolBoxVarId, foodItemId: pharmaItemId, name: 'Box / علبة كاملة', nameAr: 'علبة كاملة', price: 120.0, stockQuantity: 50, isFraction: false, fractionMultiplier: 3 }
  });

  await prisma.foodItemVariant.upsert({
    where: { id: panadolStripVarId },
    update: { price: 40.0, stockQuantity: 150, isFraction: true, fractionMultiplier: 1 },
    create: { id: panadolStripVarId, foodItemId: pharmaItemId, name: 'Strip / شريط', nameAr: 'شريط', price: 40.0, stockQuantity: 150, isFraction: true, fractionMultiplier: 1 }
  });

  await fsLegitPhRef.collection('sections').doc(pharmaSecId).collection('items').doc(pharmaItemId).set({
    id: pharmaItemId,
    sectionId: pharmaSecId,
    name: 'Panadol Joint / بنادول للمفاصل',
    nameAr: 'بنادول للمفاصل',
    price: 120.0,
    hasFractions: true,
    fractionUnitName: 'Strip',
    fractionUnitNameAr: 'شريط',
    unitsPerParent: 3,
    fractionPrice: 40.0,
    isAvailable: true,
    stockQuantity: 50,
    variants: [
      { id: panadolBoxVarId, name: 'Box / علبة كاملة', nameAr: 'علبة كاملة', price: 120.0, stockQuantity: 50, isFraction: false, fractionMultiplier: 3 },
      { id: panadolStripVarId, name: 'Strip / شريط', nameAr: 'شريط', price: 40.0, stockQuantity: 150, isFraction: true, fractionMultiplier: 1 }
    ]
  });

  console.log('\n--- Seeding Furniture active menu with Variants ---');

  // Pre-cleanup Furniture Menu Sections & Items
  console.log('Cleaning all existing furniture sections and items to avoid duplicates...');
  const existingFuSecs = await prisma.menuSection.findMany({ where: { restaurantId: 'furniture-test-restaurant-id' } });
  for (const s of existingFuSecs) {
    await prisma.foodItemVariant.deleteMany({ where: { foodItem: { sectionId: s.id } } });
    await prisma.foodItem.deleteMany({ where: { sectionId: s.id } });
  }
  await prisma.menuSection.deleteMany({ where: { restaurantId: 'furniture-test-restaurant-id' } });

  // Delete from Firestore sections
  const fsFuSections = await fsLegitFuRef.collection('sections').get();
  for (const doc of fsFuSections.docs) {
    const fsFuItems = await doc.ref.collection('items').get();
    for (const itemDoc of fsFuItems.docs) {
      await itemDoc.ref.delete();
    }
    await doc.ref.delete();
  }
  console.log('✅ Cleaned existing furniture menu items');

  const furnSecId = 'furniture-sec-1';
  // Postgres Section
  await prisma.menuSection.upsert({
    where: { id: furnSecId },
    update: { name: 'Bedding & Mattress Covers', nameAr: 'المفروشات وأغطية المراتب', isActive: true, restaurantId: 'furniture-test-restaurant-id' },
    create: { id: furnSecId, restaurantId: 'furniture-test-restaurant-id', name: 'Bedding & Mattress Covers', nameAr: 'المفروشات وأغطية المراتب', isActive: true, sortOrder: 0 }
  });

  // Firestore Section
  await fsLegitFuRef.collection('sections').doc(furnSecId).set({ id: furnSecId, name: 'Bedding & Mattress Covers', nameAr: 'المفروشات وأغطية المراتب', isActive: true, sortOrder: 0 });

  // Postgres Mattress
  const furnItemId = 'mattress-item-id';
  await prisma.foodItem.upsert({
    where: { id: furnItemId },
    update: { name: 'Premium Comfort Mattress / مرتبة الراحة الممتازة', nameAr: 'مرتبة الراحة الممتازة', price: 2500.0, isAvailable: true, stockQuantity: 33, sectionId: furnSecId },
    create: { id: furnItemId, sectionId: furnSecId, name: 'Premium Comfort Mattress / مرتبة الراحة الممتازة', nameAr: 'مرتبة الراحة الممتازة', price: 2500.0, isAvailable: true, stockQuantity: 33 }
  });

  const mattressSingleId = 'mattress-single-id';
  const mattressDoubleId = 'mattress-double-id';
  const mattressKingId = 'mattress-king-id';

  await prisma.foodItemVariant.upsert({
    where: { id: mattressSingleId },
    update: { price: 2500.0, stockQuantity: 10 },
    create: { id: mattressSingleId, foodItemId: furnItemId, name: 'Single Size (120x200)', nameAr: 'مقاس مفرد (120x200)', price: 2500.0, stockQuantity: 10 }
  });

  await prisma.foodItemVariant.upsert({
    where: { id: mattressDoubleId },
    update: { price: 3500.0, stockQuantity: 15 },
    create: { id: mattressDoubleId, foodItemId: furnItemId, name: 'Double Size (160x200)', nameAr: 'مقاس مزدوج (160x200)', price: 3500.0, stockQuantity: 15 }
  });

  await prisma.foodItemVariant.upsert({
    where: { id: mattressKingId },
    update: { price: 4200.0, stockQuantity: 8 },
    create: { id: mattressKingId, foodItemId: furnItemId, name: 'King Size (180x200)', nameAr: 'مقاس كينج (180x200)', price: 4200.0, stockQuantity: 8 }
  });

  // Firestore Mattress
  await fsLegitFuRef.collection('sections').doc(furnSecId).collection('items').doc(furnItemId).set({
    id: furnItemId,
    sectionId: furnSecId,
    name: 'Premium Comfort Mattress / مرتبة الراحة الممتازة',
    nameAr: 'مرتبة الراحة الممتازة',
    price: 2500.0,
    isAvailable: true,
    stockQuantity: 33,
    variants: [
      { id: mattressSingleId, name: 'Single Size (120x200)', nameAr: 'مقاس مفرد (120x200)', price: 2500.0, stockQuantity: 10 },
      { id: mattressDoubleId, name: 'Double Size (160x200)', nameAr: 'مقاس مزدوج (160x200)', price: 3500.0, stockQuantity: 15 },
      { id: mattressKingId, name: 'King Size (180x200)', nameAr: 'مقاس كينج (180x200)', price: 4200.0, stockQuantity: 8 }
    ]
  });

  // Align roles in Firestore just to be completely safe
  await db.collection('users').doc('QPBzlOR8WKb8APfi8iBflXHh2ml2').update({ role: 'vendor', status: 'active', applicationStatus: 'approved' }).catch(() => {});
  await db.collection('users').doc('oy2obDfLswReNk2fgBPzPiL7A593').update({ role: 'vendor', status: 'active', applicationStatus: 'approved' }).catch(() => {});

  console.log('\n=== MIGRATION AND SEEDING COMPLETED SUCCESSFULLY ===');
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
