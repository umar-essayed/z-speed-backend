const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from BACKEND/.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function initFirebase() {
  if (!admin.apps.length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey) {
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
      console.log("Firebase initialized successfully using environment variables!");
    } else {
      throw new Error("FIREBASE_PRIVATE_KEY not found in environment variables!");
    }
  }
}

async function main() {
  await initFirebase();
  const auth = admin.auth();
  const db = admin.firestore();

  console.log("\n--- Checking Firebase Auth ---");
  let fbUser = null;
  try {
    fbUser = await auth.getUserByEmail('pharmacy@zspeedapp.com');
    console.log("Found user in Firebase Auth:");
    console.log(JSON.stringify({
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      disabled: fbUser.disabled
    }, null, 2));
  } catch (e) {
    console.log("Error or user not found by email in Firebase Auth:", e.message);
  }

  if (fbUser) {
    console.log(`\n--- Checking Firestore users collection for UID: ${fbUser.uid} ---`);
    const userDoc = await db.collection('users').doc(fbUser.uid).get();
    if (userDoc.exists) {
      console.log("Firestore /users document data:");
      console.log(JSON.stringify(userDoc.data(), null, 2));
    } else {
      console.log("No document found in Firestore /users collection.");
    }

    console.log(`\n--- Checking Firestore restaurants where ownerId is ${fbUser.uid} ---`);
    const restsByOwner = await db.collection('restaurants').where('ownerId', '==', fbUser.uid).get();
    console.log(`Found ${restsByOwner.size} restaurants:`);
    restsByOwner.forEach(doc => {
      console.log(`ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  }

  console.log("\n--- Listing ALL Firestore Restaurants ---");
  const allRests = await db.collection('restaurants').get();
  console.log(`Total restaurants in Firestore: ${allRests.size}`);
  allRests.forEach(doc => {
    console.log(`ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  console.log("\n--- Listing ALL Firestore Users ---");
  const allUsers = await db.collection('users').get();
  console.log(`Total users in Firestore: ${allUsers.size}`);
  allUsers.forEach(doc => {
    console.log(`ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

main().catch(console.error);
