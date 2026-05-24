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

  console.log('=== TEST DATA GENERATION START ===');

  // =============================================
  // 1. PHARMACY SECTION & ITEM (WITH FRACTIONS)
  // =============================================
  console.log('\n--- Creating Pharmacy Section & Item (Panadol Joint) ---');

  // Postgres MenuSection
  const pharmaSecId = 'pharmacy-sec-1';
  await prisma.menuSection.upsert({
    where: { id: pharmaSecId },
    update: {
      name: 'Medicines',
      nameAr: 'الأدوية العلاجية',
      isActive: true
    },
    create: {
      id: pharmaSecId,
      restaurantId: pharmacyId,
      name: 'Medicines',
      nameAr: 'الأدوية العلاجية',
      isActive: true,
      sortOrder: 0
    }
  });
  console.log('✅ Upserted Pharmacy Section in Postgres');

  // Firestore MenuSection
  const pharmaSecRef = db.collection('restaurants').doc(pharmacyId).collection('sections').doc(pharmaSecId);
  await pharmaSecRef.set({
    id: pharmaSecId,
    name: 'Medicines',
    nameAr: 'الأدوية العلاجية',
    isActive: true,
    sortOrder: 0
  });
  console.log('✅ Upserted Pharmacy Section in Firestore');

  // Postgres FoodItem (hasFractions = true)
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
      stockQuantity: 50
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
  console.log('✅ Upserted Panadol FoodItem in Postgres');

  // Postgres Variants for Panadol
  const panadolBoxVarId = 'panadol-box-var-id';
  const panadolStripVarId = 'panadol-strip-var-id';

  await prisma.foodItemVariant.upsert({
    where: { id: panadolBoxVarId },
    update: {
      price: 120.0,
      stockQuantity: 50,
      isFraction: false,
      fractionMultiplier: 3
    },
    create: {
      id: panadolBoxVarId,
      foodItemId: pharmaItemId,
      name: 'Box / علبة كاملة',
      nameAr: 'علبة كاملة',
      price: 120.0,
      stockQuantity: 50,
      isFraction: false,
      fractionMultiplier: 3
    }
  });

  await prisma.foodItemVariant.upsert({
    where: { id: panadolStripVarId },
    update: {
      price: 40.0,
      stockQuantity: 150,
      isFraction: true,
      fractionMultiplier: 1
    },
    create: {
      id: panadolStripVarId,
      foodItemId: pharmaItemId,
      name: 'Strip / شريط',
      nameAr: 'شريط',
      price: 40.0,
      stockQuantity: 150,
      isFraction: true,
      fractionMultiplier: 1
    }
  });
  console.log('✅ Upserted Panadol Box & Strip Variants in Postgres');

  // Firestore FoodItem (under sections subcollection)
  const pharmaItemRef = pharmaSecRef.collection('items').doc(pharmaItemId);
  await pharmaItemRef.set({
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
      {
        id: panadolBoxVarId,
        name: 'Box / علبة كاملة',
        nameAr: 'علبة كاملة',
        price: 120.0,
        stockQuantity: 50,
        isFraction: false,
        fractionMultiplier: 3
      },
      {
        id: panadolStripVarId,
        name: 'Strip / شريط',
        nameAr: 'شريط',
        price: 40.0,
        stockQuantity: 150,
        isFraction: true,
        fractionMultiplier: 1
      }
    ]
  });
  console.log('✅ Upserted Panadol FoodItem & nested variants in Firestore');


  // =============================================
  // 2. FURNITURE SECTIONS & ITEM (WITH SIZES)
  // =============================================
  console.log('\n--- Creating Furniture Sections & Item (Comfort Mattress) ---');

  const furnSecId = 'furniture-sec-1';
  // Ensure the section exists in Firestore (already exists in Postgres)
  const furnSecRef = db.collection('restaurants').doc(furnitureId).collection('sections').doc(furnSecId);
  await furnSecRef.set({
    id: furnSecId,
    name: 'Bedding & Mattress Covers',
    nameAr: 'المفروشات وأغطية المراتب',
    isActive: true,
    sortOrder: 0
  });
  console.log('✅ Upserted Furniture Section in Firestore');

  // Postgres FoodItem
  const furnItemId = 'mattress-item-id';
  await prisma.foodItem.upsert({
    where: { id: furnItemId },
    update: {
      name: 'Premium Comfort Mattress / مرتبة الراحة الممتازة',
      nameAr: 'مرتبة الراحة الممتازة',
      price: 2500.0,
      isAvailable: true,
      stockQuantity: 33
    },
    create: {
      id: furnItemId,
      sectionId: furnSecId,
      name: 'Premium Comfort Mattress / مرتبة الراحة الممتازة',
      nameAr: 'مرتبة الراحة الممتازة',
      price: 2500.0,
      isAvailable: true,
      stockQuantity: 33
    }
  });
  console.log('✅ Upserted Comfort Mattress FoodItem in Postgres');

  // Postgres Variants for Mattress (Single, Double, King)
  const mattressSingleId = 'mattress-single-id';
  const mattressDoubleId = 'mattress-double-id';
  const mattressKingId = 'mattress-king-id';

  await prisma.foodItemVariant.upsert({
    where: { id: mattressSingleId },
    update: { price: 2500.0, stockQuantity: 10 },
    create: {
      id: mattressSingleId,
      foodItemId: furnItemId,
      name: 'Single Size (120x200)',
      nameAr: 'مقاس مفرد (120x200)',
      price: 2500.0,
      stockQuantity: 10
    }
  });

  await prisma.foodItemVariant.upsert({
    where: { id: mattressDoubleId },
    update: { price: 3500.0, stockQuantity: 15 },
    create: {
      id: mattressDoubleId,
      foodItemId: furnItemId,
      name: 'Double Size (160x200)',
      nameAr: 'مقاس مزدوج (160x200)',
      price: 3500.0,
      stockQuantity: 15
    }
  });

  await prisma.foodItemVariant.upsert({
    where: { id: mattressKingId },
    update: { price: 4200.0, stockQuantity: 8 },
    create: {
      id: mattressKingId,
      foodItemId: furnItemId,
      name: 'King Size (180x200)',
      nameAr: 'مقاس كينج (180x200)',
      price: 4200.0,
      stockQuantity: 8
    }
  });
  console.log('✅ Upserted Mattress Size Variants in Postgres');

  // Firestore FoodItem with nested variants array
  const furnItemRef = furnSecRef.collection('items').doc(furnItemId);
  await furnItemRef.set({
    id: furnItemId,
    sectionId: furnSecId,
    name: 'Premium Comfort Mattress / مرتبة الراحة الممتازة',
    nameAr: 'مرتبة الراحة الممتازة',
    price: 2500.0,
    isAvailable: true,
    stockQuantity: 33,
    variants: [
      {
        id: mattressSingleId,
        name: 'Single Size (120x200)',
        nameAr: 'مقاس مفرد (120x200)',
        price: 2500.0,
        stockQuantity: 10
      },
      {
        id: mattressDoubleId,
        name: 'Double Size (160x200)',
        nameAr: 'مقاس مزدوج (160x200)',
        price: 3500.0,
        stockQuantity: 15
      },
      {
        id: mattressKingId,
        name: 'King Size (180x200)',
        nameAr: 'مقاس كينج (180x200)',
        price: 4200.0,
        stockQuantity: 8
      }
    ]
  });
  console.log('✅ Upserted Comfort Mattress & variants in Firestore');

  console.log('\n=== TEST DATA GENERATION COMPLETED SUCCESSFULLY ===');
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
