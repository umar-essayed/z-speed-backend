import * as admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

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
  console.log('🔍 Checking Firestore prescription_requests collection...');
  await initFirebase();
  const db = admin.firestore();

  const restaurantId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';
  
  const snapshot = await db.collection('prescription_requests').where('restaurantId', '==', restaurantId).get();
  console.log(`Found ${snapshot.size} prescription requests for pharmacy ${restaurantId}`);

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`- Request ID: ${doc.id}, Status: ${data.status}, Customer: ${data.customerName}`);

    // Upsert into PostgreSQL
    await prisma.prescriptionRequest.upsert({
      where: { id: doc.id },
      update: {
        status: data.status,
        items: data.items || [],
        subtotal: data.subtotal,
        deliveryFee: data.deliveryFee,
        tax: data.tax,
        serviceFee: data.serviceFee,
        total: data.total,
      },
      create: {
        id: doc.id,
        customerId: data.customerId || 'mock_cust_id',
        customerName: data.customerName || 'Customer',
        customerPhone: data.customerPhone || '000000',
        restaurantId: data.restaurantId || restaurantId,
        restaurantName: data.restaurantName || 'Z-SPEED Premium Pharmacy',
        prescriptionImageUrl: data.prescriptionImageUrl || data.imageUrl || '',
        imageUrl: data.imageUrl || data.prescriptionImageUrl || '',
        status: data.status || 'pending',
        chatId: data.chatId || `chat_cust_${data.customerId || 'mock'}_pharm_${restaurantId}`,
        items: data.items || [],
        subtotal: data.subtotal,
        deliveryFee: data.deliveryFee,
        tax: data.tax,
        serviceFee: data.serviceFee,
        total: data.total,
      }
    });
    console.log(`  Synced ${doc.id} to PostgreSQL database!`);
  }

  if (snapshot.size === 0) {
    console.log('⚠️ No prescription requests found. Creating a mock live prescription request...');
    const customerId = 'cust_mock_user_123';
    const chatId = `chat_cust_${customerId}_pharm_${restaurantId}`;
    const now = new Date();

    const newReqRef = db.collection('prescription_requests').doc('PR_mock_999');
    await newReqRef.set({
      id: 'PR_mock_999',
      customerId: customerId,
      customerName: 'عمر السيد (عميل تجريبي)',
      customerPhone: '+201012345678',
      restaurantId: restaurantId,
      restaurantName: 'Z-SPEED Premium Pharmacy',
      prescriptionImageUrl: 'https://images.unsplash.com/photo-1585435557343-3b092031a831?w=600&h=800&fit=crop',
      imageUrl: 'https://images.unsplash.com/photo-1585435557343-3b092031a831?w=600&h=800&fit=crop',
      status: 'pending',
      chatId: chatId,
      items: [],
      createdAt: now,
      updatedAt: now,
    });

    await prisma.prescriptionRequest.create({
      data: {
        id: 'PR_mock_999',
        customerId: customerId,
        customerName: 'عمر السيد (عميل تجريبي)',
        customerPhone: '+201012345678',
        restaurantId: restaurantId,
        restaurantName: 'Z-SPEED Premium Pharmacy',
        prescriptionImageUrl: 'https://images.unsplash.com/photo-1585435557343-3b092031a831?w=600&h=800&fit=crop',
        imageUrl: 'https://images.unsplash.com/photo-1585435557343-3b092031a831?w=600&h=800&fit=crop',
        status: 'pending',
        chatId: chatId,
        items: [],
      }
    });

    console.log('✅ Created mock prescription request PR_mock_999 successfully in Firestore and PostgreSQL!');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
