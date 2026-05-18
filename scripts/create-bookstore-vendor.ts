import { PrismaClient, Role, AccountStatus } from '@prisma/client';
import * as admin from 'firebase-admin';
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
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    } else {
      throw new Error('No Firebase credentials found! Please check FIREBASE-KEY.json or env vars.');
    }
  }
}

async function main() {
  console.log('📚 Initializing Bookstore Seeding Script...');
  
  await initFirebase();
  const auth = admin.auth();

  const email = 'bookstore@zspeedapp.com';
  const password = 'ZSpeed@Bookstore55';
  let firebaseUid = '';

  // 1. Create/Retrieve Firebase Auth User
  try {
    const fbUser = await auth.getUserByEmail(email);
    firebaseUid = fbUser.uid;
    console.log(`ℹ️ Firebase Auth user already exists: ${email} (${firebaseUid})`);
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      const newUser = await auth.createUser({
        email,
        password,
        displayName: 'Z-SPEED Bookstore',
        emailVerified: true,
      });
      firebaseUid = newUser.uid;
      console.log(`✅ Created new Firebase Auth user: ${email} (${firebaseUid})`);
    } else {
      throw err;
    }
  }

  // 2. Create/Retrieve User in PostgreSQL
  const dbUser = await prisma.user.upsert({
    where: { email },
    update: {
      role: Role.VENDOR,
      status: AccountStatus.ACTIVE,
      firebaseUid,
    },
    create: {
      email,
      name: 'Z-SPEED Bookstore Owner',
      role: Role.VENDOR,
      status: AccountStatus.ACTIVE,
      firebaseUid,
      authProvider: 'email',
      emailVerified: true,
    },
  });
  console.log(`✅ Verified database Vendor user: ${dbUser.email} (ID: ${dbUser.id})`);

  // 3. Create Z-SPEED Premium Bookstore Restaurant Entity
  const restaurant = await prisma.restaurant.upsert({
    where: { firebaseId: `bookstore-ref-${firebaseUid}` },
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
    },
    create: {
      ownerId: dbUser.id,
      name: 'Z-SPEED Premium Bookstore',
      nameAr: 'مكتبة زد سبيد الفاخرة',
      description: 'Your premium catalog for books, novels, school supplies, engineering and office tools.',
      descriptionAr: 'منصتك الفاخرة للكتب، الروايات، الأدوات المدرسية، والمستلزمات المكتبية والهندسية.',
      logoUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1000&h=400&fit=crop',
      firebaseId: `bookstore-ref-${firebaseUid}`,
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
  console.log(`✅ Verified Bookstore store: ${restaurant.name} (ID: ${restaurant.id})`);

  // 4. Create Menu Sections (Default Categories)
  const sectionsData = [
    { name: 'School Supplies & Bags', nameAr: 'الأدوات المدرسية والشنط', sortOrder: 1 },
    { name: 'Pens & Writing Instruments', nameAr: 'الأقلام وأدوات الكتابة', sortOrder: 2 },
    { name: 'Books & Novels', nameAr: 'الكتب والروايات', sortOrder: 3 },
    { name: 'Educational Textbooks', nameAr: 'الكتب الخارجية والمذكرات', sortOrder: 4 },
    { name: 'Office Equipment', nameAr: 'الأجهزة المكتبية والإلكترونيات', sortOrder: 5 },
  ];

  const sections: Record<string, string> = {};

  for (const sec of sectionsData) {
    const dbSec = await prisma.menuSection.upsert({
      where: { firebaseId: `bookstore-sec-${sec.sortOrder}-${restaurant.id}` },
      update: {
        name: sec.name,
        nameAr: sec.nameAr,
        sortOrder: sec.sortOrder,
        isActive: true,
      },
      create: {
        restaurantId: restaurant.id,
        name: sec.name,
        nameAr: sec.nameAr,
        sortOrder: sec.sortOrder,
        isActive: true,
        firebaseId: `bookstore-sec-${sec.sortOrder}-${restaurant.id}`,
      },
    });
    sections[sec.name] = dbSec.id;
    console.log(`  📁 Verified Section: ${dbSec.name} / ${dbSec.nameAr}`);
  }

  // 5. Prepopulate beautiful Bookstore Items
  const itemsData = [
    // Section: School Supplies & Bags
    {
      section: 'School Supplies & Bags',
      name: 'Premium Geometry Set',
      nameAr: 'علبة هندسة فاخرة متكاملة',
      price: 75.0,
      description: 'Complete geometry toolset with precision metal compass, dividers, protractors, and rulers.',
      descriptionAr: 'طقم هندسي متكامل يحتوي على برجل معدني دقيق، منقلة، ومساطر للرسم الهندسي والرياضيات.',
      imageUrl: 'https://images.unsplash.com/photo-1516962215378-7fa2e137ae93?w=300&h=300&fit=crop',
      stockQuantity: 120,
    },
    {
      section: 'School Supplies & Bags',
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
      section: 'Pens & Writing Instruments',
      name: 'Faber-Castell Finepen 0.4 (Box of 10)',
      nameAr: 'علبة أقلام فايبر كاستل ١٠ قطع',
      price: 120.0,
      description: 'Superfine writing pens in 10 assorted vibrant colors, excellent for sketch or study.',
      descriptionAr: 'علبة أقلام تحديد وكتابة ناعمة من فايبر كاستل تحتوي على ١٠ ألوان زاهية وممتازة للدراسة والتنظيم.',
      imageUrl: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=300&h=300&fit=crop',
      stockQuantity: 90,
    },
    {
      section: 'Pens & Writing Instruments',
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
      section: 'Books & Novels',
      name: 'The Palace Walk - Naguib Mahfouz',
      nameAr: 'رواية بين القصرين - نجيب محفوظ',
      price: 140.0,
      description: 'The masterful Nobel-prize winning classic novel depicting early 20th-century family life in Cairo.',
      descriptionAr: 'التحفة الكلاسيكية للأديب الحائز على جائزة نوبل نجيب محفوظ، ترسم تفاصيل الحياة الاجتماعية في القاهرة القديمة.',
      imageUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=300&fit=crop',
      stockQuantity: 20,
    },
    {
      section: 'Books & Novels',
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
      section: 'Educational Textbooks',
      name: 'El-Moasser Mathematics Prep 3 (2026 Edition)',
      nameAr: 'كتاب المعاصر رياضيات الصف الثالث الإعدادي ٢٠٢٦',
      price: 185.0,
      description: 'The standard external textbook for third preparatory year mathematics with exams booklet.',
      descriptionAr: 'الكتاب الخارجي المعتمد الأقوى لشرح منهج الرياضيات للصف الثالث الإعدادي مع ملحق الأسئلة والامتحانات.',
      imageUrl: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=300&h=300&fit=crop',
      stockQuantity: 110,
    },
  ];

  for (const item of itemsData) {
    const sectionId = sections[item.section];
    if (!sectionId) continue;

    await prisma.foodItem.upsert({
      where: { firebaseId: `bookstore-item-${item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}` },
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
      },
      create: {
        sectionId,
        name: item.name,
        nameAr: item.nameAr,
        price: item.price,
        originalPrice: item.originalPrice || null,
        isOnSale: item.isOnSale || false,
        description: item.description,
        descriptionAr: item.descriptionAr,
        imageUrl: item.imageUrl,
        stockQuantity: item.stockQuantity,
        firebaseId: `bookstore-item-${item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        isAvailable: true,
      },
    });
    console.log(`  🔖 Verified Item: ${item.name} / ${item.nameAr} (Price: ${item.price} EGP)`);
  }

  console.log('\n🌟 SUCCESS: Premium Bookstore Account & Catalog Populated Successfully! 🌟');
  console.log('========================================================================');
  console.log(`📧 Vendor Login Email: ${email}`);
  console.log(`🔑 Vendor Login Password: ${password}`);
  console.log('========================================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
