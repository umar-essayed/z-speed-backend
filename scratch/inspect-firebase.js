const admin = require('firebase-admin');
const serviceAccount = require('../../FIREBASE-KEY.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://zspeed-default-rtdb.firebaseio.com' // Assuming standard format, or we'll test Firestore
});

async function inspectFirebase() {
  console.log('--- Inspecting Firestore ---');
  const firestore = admin.firestore();
  try {
    const ordersCol = await firestore.collection('orders').limit(1).get();
    if (!ordersCol.empty) {
      console.log('Found orders in Firestore!');
      ordersCol.forEach(doc => {
        console.log('Sample Document ID:', doc.id);
        console.log('Sample Document Data:', JSON.stringify(doc.data(), null, 2));
      });
      return; // Found in Firestore
    } else {
      console.log('No orders found in Firestore collection "orders".');
    }
  } catch (error) {
    console.error('Error reading Firestore:', error.message);
  }

  console.log('\n--- Inspecting Realtime Database ---');
  const db = admin.database();
  try {
    const ref = db.ref('orders');
    const snapshot = await ref.limitToLast(1).once('value');
    if (snapshot.exists()) {
      console.log('Found orders in Realtime Database!');
      console.log('Sample Node Data:', JSON.stringify(snapshot.val(), null, 2));
    } else {
      console.log('No orders found in RTDB node "orders".');
    }
  } catch (error) {
    console.error('Error reading RTDB:', error.message);
  }
}

inspectFirebase().finally(() => process.exit(0));
