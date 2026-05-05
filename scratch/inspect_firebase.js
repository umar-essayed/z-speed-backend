const admin = require('firebase-admin');
const serviceAccount = require('/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function inspectFirestore() {
  console.log('🚀 Starting Firestore Inspection...');
  const results = {};

  try {
    // 1. List Collections
    const collections = await db.listCollections();
    results.collections = collections.map(col => col.id);
    console.log('Found Collections:', results.collections);

    // 2. Sample from "orders" if exists
    const ordersCol = results.collections.find(c => c.toLowerCase().includes('order'));
    if (ordersCol) {
      const snapshot = await db.collection(ordersCol).limit(1).get();
      if (!snapshot.empty) {
        results.sampleOrder = snapshot.docs[0].data();
        results.orderCollectionName = ordersCol;
      }
    }

    // 3. Sample from "users" or "customers"
    const usersCol = results.collections.find(c => c.toLowerCase().includes('user') || c.toLowerCase().includes('customer'));
    if (usersCol) {
      const snapshot = await db.collection(usersCol).limit(1).get();
      if (!snapshot.empty) {
        results.sampleUser = snapshot.docs[0].data();
        results.userCollectionName = usersCol;
      }
    }

    fs.writeFileSync('/home/omar/Desktop/Z-SPEED/BACKEND/scratch/firebase_analysis.json', JSON.stringify(results, null, 2));
    console.log('✅ Analysis completed and saved to scratch/firebase_analysis.json');

  } catch (error) {
    console.error('❌ Error inspecting Firestore:', error);
  } finally {
    process.exit(0);
  }
}

inspectFirestore();
