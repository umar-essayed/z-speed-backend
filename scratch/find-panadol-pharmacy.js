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

  const output = [];

  output.push('=== SEARCHING FOR PANADOL IN FIRESTORE ===');
  
  const restsSnap = await db.collection('restaurants').get();
  output.push(`Total restaurants in Firestore: ${restsSnap.size}`);

  for (const doc of restsSnap.docs) {
    const data = doc.data();
    
    // Check all subcollections/documents
    const sectionsSnap = await doc.ref.collection('sections').get();
    const itemsList = [];

    for (const secDoc of sectionsSnap.docs) {
      const itemsSnap = await secDoc.ref.collection('items').get();
      for (const itemDoc of itemsSnap.docs) {
        const itemData = itemDoc.data();
        itemsList.push({
          id: itemDoc.id,
          name: itemData.name,
          nameAr: itemData.nameAr,
          price: itemData.price,
          hasFractions: itemData.hasFractions,
          restaurantId: itemData.restaurantId
        });
      }
    }

    if (itemsList.length > 0 || data.vendorType === 'pharmacy') {
      output.push(`Restaurant DocID: ${doc.id}`);
      output.push(`  Name: ${data.name} | NameAr: ${data.nameAr}`);
      output.push(`  VendorType: ${data.vendorType} | Status: ${data.status} | IsActive: ${data.isActive}`);
      output.push(`  Items (${itemsList.length}):`);
      for (const item of itemsList) {
        output.push(`    - Item ID: ${item.id} | Name: ${item.name} | hasFractions: ${item.hasFractions} | restaurantId: ${item.restaurantId}`);
      }
    }
  }

  fs.writeFileSync('scratch/find-panadol-output.txt', output.join('\n'));
  console.log('✅ Wrote results to scratch/find-panadol-output.txt');
}

main()
  .catch(console.error)
  .finally(() => {
    process.exit(0);
  });
