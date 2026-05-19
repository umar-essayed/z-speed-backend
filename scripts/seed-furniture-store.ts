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
  console.log('🛋️ Seeding Premium Home & Furnishing Vendor to PostgreSQL & Firestore...');
  
  await initFirebase();
  const db = admin.firestore();
  
  const email = 'furniture_vendor@test.com';
  const password = 'password123';
  let firebaseUid = 'furniture-fb-auth-uid-mock';
  let supabaseId = 'furniture-supabase-auth-uid-mock';

  // 1. Create/Retrieve Supabase Auth User (with fallback)
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) throw listError;

      const existingUser = userList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        supabaseId = existingUser.id;
        console.log(`ℹ️ Supabase Auth user already exists: ${email} (${supabaseId})`);

        // Update password
        await supabase.auth.admin.updateUserById(supabaseId, {
          password: password,
          email_confirm: true,
          user_metadata: { role: 'VENDOR', name: 'Z-Home Furnishings' }
        });
      } else {
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { role: 'VENDOR', name: 'Z-Home Furnishings' }
        });
        if (createError) throw createError;

        supabaseId = newUser.user.id;
        console.log(`✅ Created new Supabase Auth user: ${email} (${supabaseId})`);
      }
    } catch (err: any) {
      console.warn('⚠️ Supabase provisioning skipped or failed, using skeleton ID:', err.message);
    }
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
      name: 'Z-Home Furnishings Owner',
      role: Role.VENDOR,
      status: AccountStatus.ACTIVE,
      firebaseUid,
      supabaseId,
      authProvider: 'email',
      emailVerified: true,
    },
  });
  console.log(`✅ Verified database Vendor user: ${dbUser.email} (ID: ${dbUser.id})`);

  // Fixed Restaurant ID for test consistency
  const restaurantId = 'furniture-test-restaurant-id';

  // 3. Create/Upsert restaurant in PostgreSQL
  const restaurant = await prisma.restaurant.upsert({
    where: { id: restaurantId },
    update: {
      ownerId: dbUser.id,
      name: 'Z-Home Furnishings & Bedding',
      nameAr: 'زد هوم للأثاث والمفروشات',
      description: 'Your premium catalog for bedding, high-quality pillows, comforters, and home accessories.',
      descriptionAr: 'منصتك الفاخرة لأغطية الأسرة، الوسائد الطبية العلاجية، الألحفة، ومستلزمات الديكور المنزلي.',
      logoUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1000&h=400&fit=crop',
      isOpen: true,
      isActive: true,
      status: AccountStatus.ACTIVE,
      vendorType: 'homeFurnishing',
      address: '92 Mohamed Faried St., Nozha, Heliopolis, Cairo',
      city: 'Cairo',
      latitude: 30.0963,
      longitude: 31.3261,
      deliveryRadiusKm: 15.0,
      deliveryTimeMin: 30,
      deliveryTimeMax: 60,
      deliveryFeeMode: 'fixed',
      deliveryFee: 25.0,
      minimumOrder: 100.0,
      autoAcceptOrders: true,
      firebaseId: restaurantId,
    },
    create: {
      id: restaurantId,
      ownerId: dbUser.id,
      name: 'Z-Home Furnishings & Bedding',
      nameAr: 'زد هوم للأثاث والمفروشات',
      description: 'Your premium catalog for bedding, high-quality pillows, comforters, and home accessories.',
      descriptionAr: 'منصتك الفاخرة لأغطية الأسرة، الوسائد الطبية العلاجية، الألحفة، ومستلزمات الديكور المنزلي.',
      logoUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=200&h=200&fit=crop',
      coverImageUrl: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1000&h=400&fit=crop',
      firebaseId: restaurantId,
      isOpen: true,
      isActive: true,
      status: AccountStatus.ACTIVE,
      vendorType: 'homeFurnishing',
      address: '92 Mohamed Faried St., Nozha, Heliopolis, Cairo',
      city: 'Cairo',
      latitude: 30.0963,
      longitude: 31.3261,
      deliveryRadiusKm: 15.0,
      deliveryTimeMin: 30,
      deliveryTimeMax: 60,
      deliveryFeeMode: 'fixed',
      deliveryFee: 25.0,
      minimumOrder: 100.0,
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

  // 4. Create/Sync Furniture storefront to Firestore
  await db.collection('restaurants').doc(restaurantId).set({
    ownerId: dbUser.id,
    name: 'Z-Home Furnishings & Bedding',
    nameAr: 'زد هوم للأثاث والمفروشات',
    description: 'Your premium catalog for bedding, high-quality pillows, comforters, and home accessories.',
    descriptionAr: 'منصتك الفاخرة لأغطية الأسرة، الوسائد الطبية العلاجية، الألحفة، ومستلزمات الديكور المنزلي.',
    logoUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=200&h=200&fit=crop',
    coverImageUrl: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1000&h=400&fit=crop',
    status: 'ACTIVE',
    isActive: true,
    isOpen: true,
    vendorType: 'homeFurnishing',
    address: '92 Mohamed Faried St., Nozha, Heliopolis, Cairo',
    city: 'Cairo',
    latitude: 30.0963,
    longitude: 31.3261,
    deliveryRadiusKm: 15.0,
    deliveryTimeMin: 30,
    deliveryTimeMax: 60,
    deliveryFeeMode: 'fixed',
    deliveryFee: 25.0,
    minimumOrder: 100.0,
    autoAcceptOrders: true,
    rating: 5.0,
    reviewsCount: 0,
    updatedAt: new Date(),
  }, { merge: true });
  console.log(`✅ Synced Storefront to Firestore ('restaurants/${restaurantId}')`);

  // 5. Create Menu Sections (Default Categories)
  const sectionsData = [
    { id: 'furniture-sec-1', name: 'Bedding & Mattress Covers', nameAr: 'المفروشات وأغطية المراتب', sortOrder: 1 },
    { id: 'furniture-sec-2', name: 'Pillows & Cushions', nameAr: 'الوسائد والخداديات', sortOrder: 2 },
    { id: 'furniture-sec-3', name: 'Blankets & Quilts', nameAr: 'البطاطين والألحفة', sortOrder: 3 },
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

    // Create in Firestore
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

  // 6. Populate Products
  const products = [
    {
      id: 'furniture-item-1',
      sectionName: 'Bedding & Mattress Covers',
      sectionId: 'furniture-sec-1',
      name: 'Mattress Protector Comforter',
      nameAr: 'واقي مرتبة ولحاف فندقي',
      description: 'Premium waterproof mattress protector comforter, breathable dimple knit cover. Soft touch and durable protective layer.',
      descriptionAr: 'واقي مرتبة ولحاف مقاوم للماء عالي الجودة، غطاء ناعم وجيد التهوية للحماية التامة من السوائل والأتربة.',
      price: 625,
      originalPrice: 750,
      isOnSale: true,
      stockQuantity: 150,
      imageUrl: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=300&h=300&fit=crop',
      addons: {
        productClass: 'bedding',
        attributes: {
          material: '80% Cotton, 20% Polyester',
          features: ['Waterproof', 'Breathable Dimple Knit', 'Soft Touch'],
          specifications: 'Durable protective layer against spills and accidents',
          careInstructions: 'Machine washable, tumble dry low'
        },
        variations: [
          {
            name: 'Size',
            nameAr: 'المقاس',
            options: [
              { value: 'Twin 100*200', valueAr: 'فردي ١٠٠*٢٠٠', priceAdjustment: 0.0 },
              { value: 'Twin XL 120*200', valueAr: 'فردي كبير ١٢٠*٢٠٠', priceAdjustment: 75.0 },
              { value: 'Full 140*200', valueAr: 'شبه مزدوج ١٤٠*٢٠٠', priceAdjustment: 150.0 },
              { value: 'Full XL 160*200', valueAr: 'مزدوج ١٦٠*٢٠٠', priceAdjustment: 225.0 },
              { value: 'Queen 180*200', valueAr: 'كبير ١٨٠*٢٠٠', priceAdjustment: 300.0 },
              { value: 'King 200*200', valueAr: 'جامبو ٢٠٠*٢٠٠', priceAdjustment: 375.0 }
            ]
          }
        ]
      }
    },
    {
      id: 'furniture-item-2',
      sectionName: 'Pillows & Cushions',
      sectionId: 'furniture-sec-2',
      name: 'Memory Foam Contour Pillow',
      nameAr: 'مخدة فوم طبي علاجية',
      description: 'Ergonomic memory foam contour pillow for orthopedic neck support. Therapeutic comfort with thermodynamic breathable cover.',
      descriptionAr: 'وسادة طبية من الفوم العلاجي لدعم الرقبة والعمود الفقري، تأتي مع غطاء ناعم ينظم الحرارة.',
      price: 450,
      originalPrice: 550,
      isOnSale: true,
      stockQuantity: 80,
      imageUrl: 'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=300&h=300&fit=crop',
      addons: {
        productClass: 'pillow',
        attributes: {
          filling: 'High-quality Microfiber / Memory Foam',
          comfortLevel: 'Medium Firm',
          hypoallergenic: true,
          thermodynamic: true,
          antibacterial: true,
          careInstructions: 'Washable cover, wipe-clean core'
        },
        variations: [
          {
            name: 'Comfort Level & Style',
            nameAr: 'درجة المرونة والنوع',
            options: [
              { value: 'Soft Classic', valueAr: 'كلاسيك ناعم', priceAdjustment: 0.0 },
              { value: 'Medium Sandwich', valueAr: 'ساندوتش متوسط', priceAdjustment: 50.0 },
              { value: 'Firm Orthopedic', valueAr: 'طبي متماسك', priceAdjustment: 100.0 }
            ]
          }
        ]
      }
    },
    {
      id: 'furniture-item-3',
      sectionName: 'Pillows & Cushions',
      sectionId: 'furniture-sec-2',
      name: 'Premium Linen Floor Cushion',
      nameAr: 'شلتة أرضية كتان فاخرة',
      description: 'High-density foam floor cushion, elegant linen texture. Ideal for cozy modern floor seating.',
      descriptionAr: 'وسادة أرضية محشوة بالكامل بفوم عالي الكثافة مع غطاء كتان أنيق، مثالية للجلسات الأرضية العصرية والمريحة.',
      price: 300,
      originalPrice: 350,
      isOnSale: true,
      stockQuantity: 100,
      imageUrl: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=300&h=300&fit=crop',
      addons: {
        productClass: 'cushion',
        attributes: {
          filling: 'High-density polyurethane foam',
          cover: '100% Premium Linen fabric',
          dimensions: '45x45 cm',
          careInstructions: 'Removable and machine washable cover'
        }
      }
    }
  ];

  for (let idx = 0; idx < products.length; idx++) {
    const prod = products[idx];
    const sectionSqlId = sectionsSqlIds[prod.sectionName];
    if (!sectionSqlId) continue;

    // PostgreSQL Upsert
    await prisma.foodItem.upsert({
      where: { id: prod.id },
      update: {
        name: prod.name,
        nameAr: prod.nameAr,
        price: prod.price,
        originalPrice: prod.originalPrice,
        isOnSale: prod.isOnSale,
        description: prod.description,
        descriptionAr: prod.descriptionAr,
        imageUrl: prod.imageUrl,
        stockQuantity: prod.stockQuantity,
        isAvailable: true,
        addons: prod.addons as any,
        firebaseId: prod.id,
      },
      create: {
        id: prod.id,
        sectionId: sectionSqlId,
        name: prod.name,
        nameAr: prod.nameAr,
        price: prod.price,
        originalPrice: prod.originalPrice,
        isOnSale: prod.isOnSale,
        description: prod.description,
        descriptionAr: prod.descriptionAr,
        imageUrl: prod.imageUrl,
        stockQuantity: prod.stockQuantity,
        isAvailable: true,
        addons: prod.addons as any,
        firebaseId: prod.id,
      }
    });

    // Firestore Sync
    await db.collection('restaurants').doc(restaurantId)
      .collection('menuSections').doc(prod.sectionId)
      .collection('items').doc(prod.id).set({
        id: prod.id,
        sectionId: prod.sectionId,
        restaurantId: restaurantId,
        name: prod.name,
        nameAr: prod.nameAr,
        price: prod.price,
        originalPrice: prod.originalPrice,
        isOnSale: prod.isOnSale,
        description: prod.description,
        descriptionAr: prod.descriptionAr,
        imageUrl: prod.imageUrl,
        stockQuantity: prod.stockQuantity,
        isAvailable: true,
        prepTimeMin: 15,
        allergens: [],
        addons: prod.addons,
        sortOrder: idx,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, { merge: true });

    console.log(`  🔖 Verified Item: ${prod.name} / ${prod.nameAr} in Firestore & PostgreSQL`);
  }

  console.log('\n🛋️ SUCCESS: Premium Home & Furnishing Catalog Populated/Synced Successfully in Firestore & PostgreSQL! 🛋️');
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
