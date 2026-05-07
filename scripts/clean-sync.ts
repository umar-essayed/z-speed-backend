import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function cleanAndSync() {
  console.log('🚀 Starting Clean & Sync Process...');

  // 1. Initialize Firebase
  const serviceAccount = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../FIREBASE-KEY.json'), 'utf8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  const db = admin.firestore();

  try {
    // 2. CLEAN BACKEND (Order matters due to relations)
    console.log('🧹 Cleaning Backend Data (PostgreSQL)...');
    
    // Delete in correct order to satisfy foreign keys
    console.log('🧹 Cleaning dependent tables...');
    await prisma.orderItem.deleteMany({});
    await prisma.deliveryRequest.deleteMany({});
    await prisma.ledger.deleteMany({});
    await prisma.review.deleteMany({});
    await prisma.promotionUsage.deleteMany({});
    await prisma.promotion.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.pendingApproval.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.orderDispute.deleteMany({});
    await prisma.order.deleteMany({});
    
    console.log('🧹 Cleaning core tables...');
    await prisma.foodItem.deleteMany({});
    await prisma.menuSection.deleteMany({});
    await prisma.restaurant.deleteMany({});
    
    console.log('🧹 Cleaning vendor users...');
    await prisma.user.deleteMany({ where: { role: 'VENDOR' } });

    console.log('✅ Backend Cleaned.');

    // 3. SYNC FROM FIREBASE
    console.log('📡 Fetching Restaurants from Firebase...');
    const snapshot = await db.collection('restaurants').get();
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const firebaseId = doc.id;
      
      console.log(`Syncing Restaurant: ${data.name || firebaseId}`);

      // Fetch Owner Email from Firebase Users Collection
      let vendorEmail = data.email;
      if (!vendorEmail && data.ownerId) {
        const userDoc = await db.collection('users').doc(data.ownerId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          vendorEmail = userData?.email;
        }
      }
      
      if (!vendorEmail) {
        vendorEmail = `vendor_${firebaseId}@zspeed.com`;
      }

      console.log(`Owner Email found: ${vendorEmail}`);

      const vendorUser = await prisma.user.upsert({
        where: { email: vendorEmail },
        update: { firebaseUid: data.ownerId || firebaseId }, 
        create: {
          email: vendorEmail,
          name: data.name || 'Vendor',
          role: 'VENDOR',
          firebaseUid: data.ownerId || firebaseId,
        }
      });

      // Create Restaurant
      const restaurant = await prisma.restaurant.create({
        data: {
          name: data.name || 'Unnamed',
          description: data.description || '',
          address: data.address || '',
          logoUrl: data.image || data.imageUrl || '',
          rating: data.rating || 4.5,
          deliveryFee: data.deliveryFee || 0,
          firebaseId: firebaseId,
          ownerId: vendorUser.id,
          status: 'ACTIVE',
        }
      });

      // Sync Menu Sections
      const sectionsSnapshot = await db.collection('restaurants').doc(firebaseId).collection('menuSections').get();
      for (const sDoc of sectionsSnapshot.docs) {
        const sData = sDoc.data();
        const section = await prisma.menuSection.create({
          data: {
            name: sData.name,
            firebaseId: sDoc.id,
            restaurantId: restaurant.id,
          }
        });

        // Sync Food Items
        const itemsSnapshot = await db.collection('restaurants').doc(firebaseId).collection('menuSections').doc(sDoc.id).collection('foodItems').get();
        for (const iDoc of itemsSnapshot.docs) {
          const iData = iDoc.data();
          await prisma.foodItem.create({
            data: {
              name: iData.name,
              description: iData.description || '',
              price: Number(iData.price) || 0,
              imageUrl: iData.image || iData.imageUrl || '',
              firebaseId: iDoc.id,
              sectionId: section.id,
            }
          });
        }
      }
    }

    console.log('✨ Clean Sync Complete!');
  } catch (error) {
    console.error('❌ Error during clean sync:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanAndSync();
