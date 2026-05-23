const { PrismaClient } = require('@prisma/client');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function initFirebase() {
  const serviceAccount = require('../../FIREBASE-KEY.json');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

async function main() {
  console.log("=== STARTING DETAILED PHARMACY INVESTIGATION ===");
  
  // 1. Search PostgreSQL Users
  console.log("\n--- Searching users in PostgreSQL ---");
  const pgUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'pharmacy', mode: 'insensitive' } },
        { name: { contains: 'pharmacy', mode: 'insensitive' } },
        { name: { contains: 'صيدلية' } }
      ]
    },
    include: {
      ownedRestaurants: true
    }
  });
  
  console.log(`Found ${pgUsers.length} matching users in PostgreSQL:`);
  pgUsers.forEach(u => {
    console.log(JSON.stringify({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      firebaseUid: u.firebaseUid,
      ownedRestaurants: u.ownedRestaurants.map(r => ({
        id: r.id,
        name: r.name,
        firebaseId: r.firebaseId,
        isActive: r.isActive,
        isOpen: r.isOpen,
        status: r.status,
        ownerId: r.ownerId
      }))
    }, null, 2));
  });

  // 2. Search PostgreSQL Restaurants directly
  console.log("\n--- Searching restaurants in PostgreSQL ---");
  const pgRests = await prisma.restaurant.findMany({
    where: {
      OR: [
        { name: { contains: 'pharmacy', mode: 'insensitive' } },
        { name: { contains: 'صيدلية' } },
        { vendorType: { contains: 'pharmacy', mode: 'insensitive' } }
      ]
    }
  });
  
  console.log(`Found ${pgRests.length} matching restaurants in PostgreSQL:`);
  pgRests.forEach(r => {
    console.log(JSON.stringify({
      id: r.id,
      name: r.name,
      firebaseId: r.firebaseId,
      ownerId: r.ownerId,
      vendorType: r.vendorType,
      isActive: r.isActive,
      isOpen: r.isOpen,
      status: r.status
    }, null, 2));
  });

  // 3. Search Firebase Auth & Firestore
  try {
    await initFirebase();
    const auth = admin.auth();
    const db = admin.firestore();
    
    console.log("\n--- Searching Firebase Auth ---");
    // Search for pharmacy@zspeedapp.com
    try {
      const fbUser = await auth.getUserByEmail('pharmacy@zspeedapp.com');
      console.log("Found user pharmacy@zspeedapp.com in Firebase Auth:");
      console.log(JSON.stringify({
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        disabled: fbUser.disabled
      }, null, 2));
      
      // Let's check Firestore document for this UID
      const userDoc = await db.collection('users').doc(fbUser.uid).get();
      if (userDoc.exists) {
        console.log(`\nFound Firestore /users/${fbUser.uid} document:`);
        console.log(JSON.stringify(userDoc.data(), null, 2));
      } else {
        console.log(`\nNo Firestore /users/${fbUser.uid} document found.`);
      }
      
      // Let's check Firestore restaurants collection where ownerId is this UID
      const restsQuery = await db.collection('restaurants').where('ownerId', '==', fbUser.uid).get();
      console.log(`\nFound ${restsQuery.size} restaurants owned by UID ${fbUser.uid} in Firestore:`);
      restsQuery.forEach(doc => {
        console.log(`Restaurant Document ID: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
      });
      
    } catch (e) {
      console.log("Error or user not found by email in Firebase Auth:", e.message);
    }
    
    // Also list all restaurants in Firestore with 'pharmacy' or 'صيدلية' in their name
    console.log("\n--- Searching Firestore restaurants collection ---");
    const restsSnapshot = await db.collection('restaurants').get();
    console.log(`Total restaurants in Firestore: ${restsSnapshot.size}`);
    restsSnapshot.forEach(doc => {
      const data = doc.data();
      if (
        (data.name && data.name.toLowerCase().includes('pharmacy')) ||
        (data.nameAr && data.nameAr.includes('صيدلية')) ||
        (data.vendorType && data.vendorType.toLowerCase().includes('pharmacy'))
      ) {
        console.log(`Firestore Restaurant Doc ID: ${doc.id}`);
        console.log(JSON.stringify(data, null, 2));
      }
    });

  } catch (e) {
    console.log("Error checking Firebase:", e.message);
  }

  console.log("\n=== INVESTIGATION COMPLETED ===");
}

main().catch(console.error).finally(() => prisma.$disconnect());
