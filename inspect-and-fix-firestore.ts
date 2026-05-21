import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
  console.log("=== FIRESTORE COMPREHENSIVE REPAIR START ===");
  await initFirebase();
  const db = admin.firestore();

  const vendorUid = 'QPBzlOR8WKb8APfi8iBflXHh2ml2';
  const pgUuid = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';

  // 1. Repair /users/QPBzlOR8WKb8APfi8iBflXHh2ml2 document in Firestore
  // must have: type: 'restaurant', status: 'ACTIVE', role: 'vendor'
  const userDocRef = db.collection('users').doc(vendorUid);
  await userDocRef.set({
    id: vendorUid,
    uid: vendorUid,
    type: 'restaurant', // REQUIRED BY firestore.rules functions (isRestaurant())
    role: 'vendor',
    email: 'pharmacy_owner_direct@zspeed.com',
    name: 'Z-SPEED Premium Pharmacy Owner',
    status: 'ACTIVE',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log("✅ Aligned /users/QPBzlOR8WKb8APfi8iBflXHh2ml2 with type: 'restaurant'");

  // 2. We will set up both restaurants documents: 'ef6a8ac3-b836-4857-af1c-b707326f4a16' and 'QPBzlOR8WKb8APfi8iBflXHh2ml2'
  const idsToSync = [pgUuid, vendorUid];
  
  for (const restId of idsToSync) {
    const restDocRef = db.collection('restaurants').doc(restId);
    await restDocRef.set({
      id: restId,
      ownerId: vendorUid,
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`✅ Synced /restaurants/${restId}`);

    // Create Menu Sections inside this document
    const sections = [
      { id: 'pharmacy-sec-1', name: 'Cosmetics & Skin Care', nameAr: 'مستحضرات التجميل والعناية بالبشرة', sortOrder: 1 },
      { id: 'pharmacy-sec-2', name: 'OTC Drugs & Pain Relievers', nameAr: 'الأدوية والمسكنات', sortOrder: 2 },
      { id: 'pharmacy-sec-3', name: 'Baby Care & Essentials', nameAr: 'رعاية ومستلزمات الأطفال', sortOrder: 3 },
      { id: 'pharmacy-sec-4', name: 'Vitamins & Health Supplements', nameAr: 'الفيتامينات والمكملات الغذائية', sortOrder: 4 },
    ];

    for (const sec of sections) {
      const secDocRef = restDocRef.collection('menuSections').doc(sec.id);
      await secDocRef.set({
        id: sec.id,
        restaurantId: restId,
        name: sec.name,
        nameAr: sec.nameAr,
        sortOrder: sec.sortOrder,
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Create products inside this section
      const items = [
        {
          id: 'pharmacy-item-cerave-moisturizer',
          name: 'CeraVe Moisturizing Cream 454g',
          nameAr: 'سيرافي كريم مرطب ٤٥٤ جم',
          price: 320.0,
          description: 'Rich moisturizing cream with 3 essential ceramides for dry to very dry skin.',
          descriptionAr: 'كريم مرطب غني يحتوي على ٣ سيراميدات أساسية للبشرة الجافة إلى شديدة الجفاف.',
          imageUrl: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=300&h=300&fit=crop',
          stockQuantity: 150,
        },
        {
          id: 'pharmacy-item-panadol-extra',
          name: 'Panadol Extra (24 Tablets)',
          nameAr: 'بنادول إكسترا ٢٤ قرص',
          price: 45.0,
          description: 'Fast and effective temporary relief of pain and headache with paracetamol & caffeine.',
          descriptionAr: 'تسكين سريع وفعال للآلام والصداع يحتوي على الباراسيتاميل والكافيين.',
          imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&h=300&fit=crop',
          stockQuantity: 200,
        }
      ];

      for (const item of items) {
        if (sec.id === 'pharmacy-sec-1' && item.id.includes('cerave')) {
          await secDocRef.collection('items').doc(item.id).set({
            ...item,
            sectionId: sec.id,
            restaurantId: restId,
            isAvailable: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else if (sec.id === 'pharmacy-sec-2' && item.id.includes('panadol')) {
          await secDocRef.collection('items').doc(item.id).set({
            ...item,
            sectionId: sec.id,
            restaurantId: restId,
            isAvailable: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
    }
    console.log(`✅ Populated categories and items inside /restaurants/${restId}`);
  }

  console.log("=== FIRESTORE COMPREHENSIVE REPAIR END ===");
}

main().catch(console.error);
