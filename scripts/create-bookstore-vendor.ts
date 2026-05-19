import { PrismaClient, Role, AccountStatus } from '@prisma/client';
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
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
      console.log('Initializing Firebase via Environment Variables');
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      
      // Clean private key string from quotes if present
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.substring(1, privateKey.length - 1);
      }
      privateKey = privateKey.replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    } else {
      throw new Error('No Firebase credentials found! Please check FIREBASE-KEY.json or env vars.');
    }
  }
}

async function main() {
  console.log('📚 Initializing Bookstore Seeding Script (Firestore & SQL)...');
  
  await initFirebase();
  const db = admin.firestore();
  
  const email = 'bookstore@zspeedapp.com';
  const password = 'ZSpeed@Bookstore55';
  let firebaseUid = 'bookstore-fb-auth-uid-mock';
  let supabaseId = '';

  // 1. Create/Retrieve Supabase Auth User
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are missing!');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = userList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      supabaseId = existingUser.id;
      console.log(`ℹ️ Supabase Auth user already exists: ${email} (${supabaseId})`);

      // Update password to be absolutely sure it is synchronized
      const { error: updateError } = await supabase.auth.admin.updateUserById(supabaseId, {
        password: password,
        email_confirm: true,
        user_metadata: { role: 'VENDOR', name: 'Z-SPEED Bookstore' }
      });
      if (updateError) {
        console.warn(`Warning updating Supabase user details: ${updateError.message}`);
      } else {
        console.log(`✅ Updated password for Supabase Auth user successfully`);
      }
    } else {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'VENDOR', name: 'Z-SPEED Bookstore' }
      });
      if (createError) throw createError;

      supabaseId = newUser.user.id;
      console.log(`✅ Created new Supabase Auth user: ${email} (${supabaseId})`);
    }
  } catch (err: any) {
    console.error('❌ Supabase Auth provisioning failed:', err);
    throw err;
  }

  // 2. Create/Retrieve User in PostgreSQL
  const dbUser = await prisma.user.upsert({
    where: { email },
    update: {
      role: Role.VENDOR,
      status: AccountStatus.ACTIVE,
      firebaseUid,
      supabaseId,
    },
    create: {
      email,
      name: 'Z-SPEED Bookstore Owner',
      role: Role.VENDOR,
      status: AccountStatus.ACTIVE,
      firebaseUid,
      supabaseId,
      authProvider: 'email',
      emailVerified: true,
    },
  });
  console.log(`✅ Verified database Vendor user: ${dbUser.email} (ID: ${dbUser.id})`);

  // Fixed Bookstore Restaurant IDs
  const restaurantId = 'df5a8ac3-b836-4857-af1c-b707326f4a15';

  // 3. Create Z-SPEED Premium Bookstore Restaurant Entity in PostgreSQL
  const restaurant = await prisma.restaurant.upsert({
    where: { id: restaurantId },
    update: {
      ownerId: dbUser.id,
      name: 'Z-SPEED Premium Bookstore',
      nameAr: 'مكتبة زد سبيد الفاخرة',
      description: 'Your premium catalog for books, novels, school supplies, engineering and office tools.',
      descriptionAr: 'منصتك الفاخرة للكتب، الروايات، الأدوات المدرسية، والمستلزمات المكتبية والهندسية.',
      logoUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1000&h=400&fit=crop',
      isOpen: true,
      isActive: true,
      status: AccountStatus.ACTIVE,
      vendorType: 'bookstore',
      address: 'Tahrir Square, Downtown Cairo',
      city: 'Cairo',
      latitude: 30.0444,
      longitude: 31.2357,
      deliveryRadiusKm: 15.0,
      deliveryTimeMin: 20,
      deliveryTimeMax: 45,
      deliveryFeeMode: 'fixed',
      deliveryFee: 15.0,
      minimumOrder: 50.0,
      autoAcceptOrders: true,
      firebaseId: restaurantId,
    },
    create: {
      id: restaurantId,
      ownerId: dbUser.id,
      name: 'Z-SPEED Premium Bookstore',
      nameAr: 'مكتبة زد سبيد الفاخرة',
      description: 'Your premium catalog for books, novels, school supplies, engineering and office tools.',
      descriptionAr: 'منصتك الفاخرة للكتب، الروايات، الأدوات المدرسية، والمستلزمات المكتبية والهندسية.',
      logoUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1000&h=400&fit=crop',
      firebaseId: restaurantId,
      isOpen: true,
      isActive: true,
      status: AccountStatus.ACTIVE,
      vendorType: 'bookstore',
      address: 'Tahrir Square, Downtown Cairo',
      city: 'Cairo',
      latitude: 30.0444,
      longitude: 31.2357,
      deliveryRadiusKm: 15.0,
      deliveryTimeMin: 20,
      deliveryTimeMax: 45,
      deliveryFeeMode: 'fixed',
      deliveryFee: 15.0,
      minimumOrder: 50.0,
      autoAcceptOrders: true,
      workingHours: [
        { day: 'Monday', open: '09:00', close: '22:00' },
        { day: 'Tuesday', open: '09:00', close: '22:00' },
        { day: 'Wednesday', open: '09:00', close: '22:00' },
        { day: 'Thursday', open: '09:00', close: '23:00' },
        { day: 'Friday', open: '13:00', close: '23:00' },
        { day: 'Saturday', open: '09:00', close: '22:00' },
        { day: 'Sunday', open: '09:00', close: '22:00' },
      ],
    },
  });
  console.log(`✅ Verified database Bookstore store: ${restaurant.name} (ID: ${restaurant.id})`);

  // 4. Create Bookstore Restaurant document in Firestore
  await db.collection('restaurants').doc(restaurantId).set({
    ownerId: dbUser.firebaseUid || firebaseUid,
    name: 'Z-SPEED Premium Bookstore',
    nameAr: 'مكتبة زد سبيد الفاخرة',
    description: 'Your premium catalog for books, novels, school supplies, engineering and office tools.',
    descriptionAr: 'منصتك الفاخرة للكتب، الروايات، الأدوات المدرسية، والمستلزمات المكتبية والهندسية.',
    logoUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=200&h=200&fit=crop',
    coverImageUrl: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1000&h=400&fit=crop',
    status: 'ACTIVE',
    isActive: true,
    isOpen: true,
    vendorType: 'bookstore',
    address: 'Tahrir Square, Downtown Cairo',
    city: 'Cairo',
    latitude: 30.0444,
    longitude: 31.2357,
    deliveryRadiusKm: 15.0,
    deliveryTimeMin: 20,
    deliveryTimeMax: 45,
    deliveryFeeMode: 'fixed',
    deliveryFee: 15.0,
    minimumOrder: 50.0,
    autoAcceptOrders: true,
    rating: 5.0,
    reviewsCount: 0,
    updatedAt: new Date(),
  }, { merge: true });
  console.log(`✅ Synced Bookstore storefront to Firestore ('restaurants/${restaurantId}')`);

  // 5. Create Menu Sections (Default Categories)
  const sectionsData = [
    { id: 'bookstore-sec-1', name: 'School Supplies & Bags', nameAr: 'الأدوات المدرسية والشنط', sortOrder: 1 },
    { id: 'bookstore-sec-2', name: 'Pens & Writing Instruments', nameAr: 'الأقلام وأدوات الكتابة', sortOrder: 2 },
    { id: 'bookstore-sec-3', name: 'Books & Novels', nameAr: 'الكتب والروايات', sortOrder: 3 },
    { id: 'bookstore-sec-4', name: 'Educational Textbooks', nameAr: 'الكتب الخارجية والمذكرات', sortOrder: 4 },
    { id: 'bookstore-sec-5', name: 'Office Equipment', nameAr: 'الأجهزة المكتبية والإلكترونيات', sortOrder: 5 },
  ];

  const sectionsSqlIds: Record<string, string> = {};

  for (const sec of sectionsData) {
    // Upsert section in PostgreSQL
    const dbSec = await prisma.menuSection.upsert({
      where: { id: sec.id },
      update: {
        name: sec.name,
        nameAr: sec.nameAr,
        sortOrder: sec.sortOrder,
        isActive: true,
        firebaseId: sec.id,
      },
      create: {
        id: sec.id,
        restaurantId: restaurant.id,
        name: sec.name,
        nameAr: sec.nameAr,
        sortOrder: sec.sortOrder,
        isActive: true,
        firebaseId: sec.id,
      },
    });
    sectionsSqlIds[sec.name] = dbSec.id;

    // Create section document in Firestore
    await db.collection('restaurants').doc(restaurantId)
      .collection('menuSections').doc(sec.id).set({
        id: sec.id,
        restaurantId: restaurantId,
        name: sec.name,
        nameAr: sec.nameAr,
        sortOrder: sec.sortOrder,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, { merge: true });

    console.log(`  📁 Verified Section: ${dbSec.name} / ${dbSec.nameAr} inside Firestore & PostgreSQL`);
  }

  // 6. Prepopulate beautiful Bookstore Items in PostgreSQL and Firestore
  const itemsData = [
    // Section: School Supplies & Bags
    {
      id: 'bookstore-item-geometry-set',
      sectionName: 'School Supplies & Bags',
      sectionId: 'bookstore-sec-1',
      name: 'Premium Geometry Set',
      nameAr: 'علبة هندسة فاخرة متكاملة',
      price: 75.0,
      description: 'Complete geometry toolset with precision metal compass, dividers, protractors, and rulers.',
      descriptionAr: 'طقم هندسي متكامل يحتوي على برجل معدني دقيق، منقلة، ومساطر للرسم الهندسي والرياضيات.',
      imageUrl: 'https://images.unsplash.com/photo-1516962215378-7fa2e137ae93?w=300&h=300&fit=crop',
      stockQuantity: 120,
    },
    {
      id: 'bookstore-item-school-backpack',
      sectionName: 'School Supplies & Bags',
      sectionId: 'bookstore-sec-1',
      name: 'Ergonomic Waterproof Backpack',
      nameAr: 'حقيبة مدرسية مريحة ومقاومة للماء',
      price: 450.0,
      originalPrice: 499.0,
      isOnSale: true,
      description: 'Waterproof multi-compartment primary school backpack with orthopedic back support.',
      descriptionAr: 'شنطة مدرسية مقاومة للماء مع جيوب متعددة ودعم طبي مريح للظهر لراحة العمود الفقري.',
      imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=300&h=300&fit=crop',
      stockQuantity: 35,
    },

    // Section: Pens & Writing Instruments
    {
      id: 'bookstore-item-faber-finepen',
      sectionName: 'Pens & Writing Instruments',
      sectionId: 'bookstore-sec-2',
      name: 'Faber-Castell Finepen 0.4 (Box of 10)',
      nameAr: 'علبة أقلام فايبر كاستل ١٠ قطع',
      price: 120.0,
      description: 'Superfine writing pens in 10 assorted vibrant colors, excellent for sketch or study.',
      descriptionAr: 'علبة أقلام تحديد وكتابة ناعمة من فايبر كاستل تحتوي على ١٠ ألوان زاهية وممتازة للدراسة والتنظيم.',
      imageUrl: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=300&h=300&fit=crop',
      stockQuantity: 90,
    },
    {
      id: 'bookstore-item-stabilo-highlighters',
      sectionName: 'Pens & Writing Instruments',
      sectionId: 'bookstore-sec-2',
      name: 'Stabilo Boss Neon Highlighters (6 colors)',
      nameAr: 'طقم أقلام تحديد ستابيلو ٦ ألوان',
      price: 95.0,
      description: 'Original Stabilo Boss fluorescent highlighters for textbook studying and key notes.',
      descriptionAr: 'طقم أقلام تظليل ستابيلو الأصلي الفسفوري لتحديد النصوص والدروس الهامة بوضوح.',
      imageUrl: 'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=300&h=300&fit=crop',
      stockQuantity: 150,
    },

    // Section: Books & Novels
    {
      id: 'bookstore-item-naguib-palace',
      sectionName: 'Books & Novels',
      sectionId: 'bookstore-sec-3',
      name: 'The Palace Walk - Naguib Mahfouz',
      nameAr: 'رواية بين القصرين - نجيب محفوظ',
      price: 140.0,
      description: 'The masterful Nobel-prize winning classic novel depicting early 20th-century family life in Cairo.',
      descriptionAr: 'التحفة الكلاسيكية للأديب الحائز على جائزة نوبل نجيب محفوظ، ترسم تفاصيل الحياة الاجتماعية في القاهرة القديمة.',
      imageUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=300&fit=crop',
      stockQuantity: 20,
    },
    {
      id: 'bookstore-item-coelho-alchemist',
      sectionName: 'Books & Novels',
      sectionId: 'bookstore-sec-3',
      name: 'The Alchemist - Paulo Coelho',
      nameAr: 'رواية الخيميائي - باولو كويلو',
      price: 95.0,
      description: 'Paulo Coelhos worldwide best-selling inspirational allegory about finding ones destiny.',
      descriptionAr: 'الرواية العالمية الملهمة والأكثر مبيعاً لباولو كويلو، تدور حول تحقيق الأحلام واكتشاف الذات.',
      imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300&h=300&fit=crop',
      stockQuantity: 45,
    },

    // Section: Educational Textbooks
    {
      id: 'bookstore-item-moasser-math',
      sectionName: 'Educational Textbooks',
      sectionId: 'bookstore-sec-4',
      name: 'El-Moasser Mathematics Prep 3 (2026 Edition)',
      nameAr: 'كتاب المعاصر رياضيات الصف الثالث الإعدادي ٢٠٢٦',
      price: 185.0,
      description: 'The standard external textbook for third preparatory year mathematics with exams booklet.',
      descriptionAr: 'الكتاب الخارجي المعتمد الأقوى لشرح منهج الرياضيات للصف الثالث الإعدادي مع ملحق الأسئلة والامتحانات.',
      imageUrl: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=300&h=300&fit=crop',
      stockQuantity: 110,
    },
  ];

  for (let idx = 0; idx < itemsData.length; idx++) {
    const item = itemsData[idx];
    const sectionSqlId = sectionsSqlIds[item.sectionName];
    if (!sectionSqlId) continue;

    // Upsert food item in PostgreSQL
    await prisma.foodItem.upsert({
      where: { id: item.id },
      update: {
        name: item.name,
        nameAr: item.nameAr,
        price: item.price,
        originalPrice: item.originalPrice || null,
        isOnSale: item.isOnSale || false,
        description: item.description,
        descriptionAr: item.descriptionAr,
        imageUrl: item.imageUrl,
        stockQuantity: item.stockQuantity,
        isAvailable: true,
        firebaseId: item.id,
      },
      create: {
        id: item.id,
        sectionId: sectionSqlId,
        name: item.name,
        nameAr: item.nameAr,
        price: item.price,
        originalPrice: item.originalPrice || null,
        isOnSale: item.isOnSale || false,
        description: item.description,
        descriptionAr: item.descriptionAr,
        imageUrl: item.imageUrl,
        stockQuantity: item.stockQuantity,
        firebaseId: item.id,
        isAvailable: true,
      },
    });

    // Create item document in Firestore
    await db.collection('restaurants').doc(restaurantId)
      .collection('menuSections').doc(item.sectionId)
      .collection('items').doc(item.id).set({
        id: item.id,
        sectionId: item.sectionId,
        restaurantId: restaurantId,
        name: item.name,
        nameAr: item.nameAr,
        price: item.price,
        originalPrice: item.originalPrice || null,
        isOnSale: item.isOnSale || false,
        description: item.description,
        descriptionAr: item.descriptionAr,
        imageUrl: item.imageUrl,
        stockQuantity: item.stockQuantity,
        isAvailable: true,
        prepTimeMin: 15,
        allergens: [],
        sortOrder: idx,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, { merge: true });

    console.log(`  🔖 Verified Item: ${item.name} / ${item.nameAr} in Firestore & PostgreSQL`);
  }

  console.log('\n🌟 SUCCESS: Premium Bookstore Account & Catalog Populated Successfully in Firestore & PostgreSQL! 🌟');
  console.log('==============================================================================================');
  console.log(`📧 Vendor Login Email: ${email}`);
  console.log(`🔑 Vendor Login Password: ${password}`);
  console.log('==============================================================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
