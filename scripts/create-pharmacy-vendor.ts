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
  console.log('🏥 Initializing Pharmacy Seeding Script (Firestore & SQL)...');
  
  await initFirebase();
  const db = admin.firestore();
  
  const email = 'pharmacy@zspeedapp.com';
  const password = 'ZSpeed@Pharmacy55';
  let firebaseUid = 'pharmacy-fb-auth-uid-mock';
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

      const { error: updateError } = await supabase.auth.admin.updateUserById(supabaseId, {
        password: password,
        email_confirm: true,
        user_metadata: { role: 'VENDOR', name: 'Z-SPEED Premium Pharmacy' }
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
        user_metadata: { role: 'VENDOR', name: 'Z-SPEED Premium Pharmacy' }
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
      name: 'Z-SPEED Pharmacy Owner',
      role: Role.VENDOR,
      status: AccountStatus.ACTIVE,
      firebaseUid,
      supabaseId,
      authProvider: 'email',
      emailVerified: true,
    },
  });
  console.log(`✅ Verified database Vendor user: ${dbUser.email} (ID: ${dbUser.id})`);

  // Fixed Pharmacy Restaurant ID
  const restaurantId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';

  // 3. Create Z-SPEED Premium Pharmacy Restaurant Entity in PostgreSQL
  const restaurant = await prisma.restaurant.upsert({
    where: { id: restaurantId },
    update: {
      ownerId: dbUser.id,
      name: 'Z-SPEED Premium Pharmacy',
      nameAr: 'صيدلية زد سبيد الفاخرة',
      description: 'Your premium 24/7 destination for prescription medicine, dermatological skincare, infant wellness, and healthcare supplements.',
      descriptionAr: 'وجهتك الفاخرة على مدار الساعة للأدوية الطبية، مستحضرات التجميل العلاجية، رعاية الأطفال، والمكملات الغذائية.',
      logoUrl: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1586015555751-63bb77f4322a?w=1000&h=400&fit=crop',
      isOpen: true,
      isActive: true,
      status: AccountStatus.ACTIVE,
      vendorType: 'pharmacy',
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
      name: 'Z-SPEED Premium Pharmacy',
      nameAr: 'صيدلية زد سبيد الفاخرة',
      description: 'Your premium 24/7 destination for prescription medicine, dermatological skincare, infant wellness, and healthcare supplements.',
      descriptionAr: 'وجهتك الفاخرة على مدار الساعة للأدوية الطبية، مستحضرات التجميل العلاجية، رعاية الأطفال، والمكملات الغذائية.',
      logoUrl: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1586015555751-63bb77f4322a?w=1000&h=400&fit=crop',
      firebaseId: restaurantId,
      isOpen: true,
      isActive: true,
      status: AccountStatus.ACTIVE,
      vendorType: 'pharmacy',
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
        { day: 'Monday', open: '00:00', close: '23:59' },
        { day: 'Tuesday', open: '00:00', close: '23:59' },
        { day: 'Wednesday', open: '00:00', close: '23:59' },
        { day: 'Thursday', open: '00:00', close: '23:59' },
        { day: 'Friday', open: '00:00', close: '23:59' },
        { day: 'Saturday', open: '00:00', close: '23:59' },
        { day: 'Sunday', open: '00:00', close: '23:59' },
      ],
    },
  });
  console.log(`✅ Verified database Pharmacy store: ${restaurant.name} (ID: ${restaurant.id})`);

  // 4. Create Pharmacy Restaurant document in Firestore
  await db.collection('restaurants').doc(restaurantId).set({
    ownerId: dbUser.firebaseUid || firebaseUid,
    name: 'Z-SPEED Premium Pharmacy',
    nameAr: 'صيدلية زد سبيد الفاخرة',
    description: 'Your premium 24/7 destination for prescription medicine, dermatological skincare, infant wellness, and healthcare supplements.',
    descriptionAr: 'وجهتك الفاخرة على مدار الساعة للأدوية الطبية، مستحضرات التجميل العلاجية، رعاية الأطفال، والمكملات الغذائية.',
    logoUrl: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=200&h=200&fit=crop',
    coverImageUrl: 'https://images.unsplash.com/photo-1586015555751-63bb77f4322a?w=1000&h=400&fit=crop',
    status: 'ACTIVE',
    isActive: true,
    isOpen: true,
    vendorType: 'pharmacy',
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
  console.log(`✅ Synced Pharmacy storefront to Firestore ('restaurants/${restaurantId}')`);

  // 5. Create Menu Sections (Pharmacy Categories)
  const sectionsData = [
    { id: 'pharmacy-sec-1', name: 'Cosmetics & Skin Care', nameAr: 'مستحضرات التجميل والعناية بالبشرة', sortOrder: 1 },
    { id: 'pharmacy-sec-2', name: 'OTC Drugs & Pain Relievers', nameAr: 'الأدوية والمسكنات', sortOrder: 2 },
    { id: 'pharmacy-sec-3', name: 'Baby Care & Essentials', nameAr: 'رعاية ومستلزمات الأطفال', sortOrder: 3 },
    { id: 'pharmacy-sec-4', name: 'Vitamins & Health Supplements', nameAr: 'الفيتامينات والمكملات الغذائية', sortOrder: 4 },
  ];

  const sectionsSqlIds: Record<string, string> = {};

  for (const sec of sectionsData) {
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

  // 6. Prepopulate Pharmacy Products in PostgreSQL and Firestore
  const itemsData = [
    // Section: Cosmetics & Skin Care
    {
      id: 'pharmacy-item-cerave-moisturizer',
      sectionName: 'Cosmetics & Skin Care',
      sectionId: 'pharmacy-sec-1',
      name: 'CeraVe Moisturizing Cream 454g',
      nameAr: 'سيرافي كريم مرطب ٤٥٤ جم',
      price: 320.0,
      description: 'Rich moisturizing cream with 3 essential ceramides for dry to very dry skin.',
      descriptionAr: 'كريم مرطب غني يحتوي على ٣ سيراميدات أساسية للبشرة الجافة إلى شديدة الجفاف.',
      imageUrl: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=300&h=300&fit=crop',
      stockQuantity: 150,
    },
    {
      id: 'pharmacy-item-sunscreen',
      sectionName: 'Cosmetics & Skin Care',
      sectionId: 'pharmacy-sec-1',
      name: 'La Roche-Posay Anthelios SPF 50+',
      nameAr: 'واقي شمس لاروش بوزيه ٥٠+',
      price: 450.0,
      description: 'High broad-spectrum sunscreen fluid for oily, sensitive skin types.',
      descriptionAr: 'سائل واقي من الشمس ذو حماية واسعة للغاية ومناسب للبشرة الدهنية والحساسة.',
      imageUrl: 'https://images.unsplash.com/photo-1556229174-5e42a09e45af?w=300&h=300&fit=crop',
      stockQuantity: 45,
    },

    // Section: OTC Drugs & Pain Relievers
    {
      id: 'pharmacy-item-panadol-extra',
      sectionName: 'OTC Drugs & Pain Relievers',
      sectionId: 'pharmacy-sec-2',
      name: 'Panadol Extra (24 Tablets)',
      nameAr: 'بنادول إكسترا ٢٤ قرص',
      price: 45.0,
      description: 'Fast and effective temporary relief of pain and headache with paracetamol & caffeine.',
      descriptionAr: 'تسكين سريع وفعال للآلام والصداع يحتوي على الباراسيتاميل والكافيين.',
      imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&h=300&fit=crop',
      stockQuantity: 200,
    },
    {
      id: 'pharmacy-item-panadol-coldflu',
      sectionName: 'OTC Drugs & Pain Relievers',
      sectionId: 'pharmacy-sec-2',
      name: 'Panadol Cold & Flu (24 Tablets)',
      nameAr: 'بنادول كولد أند فلو ٢٤ قرص',
      price: 55.0,
      description: 'Relief of cold and flu symptoms including sinus pain, nasal congestion, and sore throat.',
      descriptionAr: 'تخفيف أعراض البرد والإنفلونزا بما في ذلك آلام الجيوب الأنفية، واحتقان الأنف، والتهاب الحلق.',
      imageUrl: 'https://images.unsplash.com/photo-1550572017-edd951b55104?w=300&h=300&fit=crop',
      stockQuantity: 180,
    },

    // Section: Baby Care & Essentials
    {
      id: 'pharmacy-item-johnsons-shampoo',
      sectionName: 'Baby Care & Essentials',
      sectionId: 'pharmacy-sec-3',
      name: "Johnson's Baby Shampoo 500ml",
      nameAr: 'شامبو جونسون للأطفال ٥٠٠ مل',
      price: 65.0,
      description: "Gentle, tear-free formulation leaves baby's hair soft and fresh.",
      descriptionAr: 'شامبو أطفال لطيف بتركيبة لا دموع بعد اليوم يترك شعر طفلك ناعماً ونظيفاً.',
      imageUrl: 'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=300&h=300&fit=crop',
      stockQuantity: 95,
    },
    {
      id: 'pharmacy-item-pampers-premium',
      sectionName: 'Baby Care & Essentials',
      sectionId: 'pharmacy-sec-3',
      name: 'Pampers Premium Care Size 4 (64 Diapers)',
      nameAr: 'حفاضات بامبرز عناية فائقة مقاس ٤',
      price: 280.0,
      description: 'Absorbent layers and silky softness for ultimate skin protection and comfort.',
      descriptionAr: 'نعومة حريرية وطبقات فائقة الامتصاص لراحة قصوى وحماية لبشرة طفلك.',
      imageUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=300&h=300&fit=crop',
      stockQuantity: 60,
    },

    // Section: Vitamins & Health Supplements
    {
      id: 'pharmacy-item-vitc-effervescent',
      sectionName: 'Vitamins & Health Supplements',
      sectionId: 'pharmacy-sec-4',
      name: 'Vitamin C 1000mg Effervescent (20 Tablets)',
      nameAr: 'فيتامين سي فوار ١٠٠٠ مجم ٢٠ قرص',
      price: 35.0,
      description: 'Daily immune booster orange-flavored effervescent tablets.',
      descriptionAr: 'أقراص فوارة بنكهة البرتقال لتعزيز المناعة اليومية ودعم الصحة العامة.',
      imageUrl: 'https://images.unsplash.com/photo-1616679911721-eff6eec18fcd?w=300&h=300&fit=crop',
      stockQuantity: 250,
    },
    {
      id: 'pharmacy-item-strepsils-honey',
      sectionName: 'Vitamins & Health Supplements',
      sectionId: 'pharmacy-sec-4',
      name: 'Strepsils Lozenges Honey & Lemon (24 Tablets)',
      nameAr: 'ستربسلز أقراص استحلاب عسل وليمون',
      price: 95.0,
      description: 'Soothing throat lozenges with antibacterial action to relieve sore throats.',
      descriptionAr: 'أقراص استحلاب ملطفة ومضادة للبكتيريا لتخفيف التهاب والآم الحلق.',
      imageUrl: 'https://images.unsplash.com/photo-1607619056574-7b8f304b3c93?w=300&h=300&fit=crop',
      stockQuantity: 120,
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
        isOnSale: false,
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

  console.log('\n🌟 SUCCESS: Premium Pharmacy Account & Catalog Populated Successfully in Firestore & PostgreSQL! 🌟');
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
