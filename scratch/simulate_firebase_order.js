const admin = require('firebase-admin');
const serviceAccount = require('/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function simulateFirebaseOrder() {
  console.log('🧪 Simulating a new Firebase order...');
  
  const orderId = `TEST_${Date.now()}`;
  const orderData = {
    customerId: 'UlZEznsHHdOq9M82ERxxYsEgMbx1', // Test Customer
    restaurantId: 'iBse6IVbrN53QikUkpqo',      // Test Restaurant
    status: 'pending',
    subtotal: 150,
    deliveryFee: 15,
    serviceFee: 5,
    total: 170,
    paymentMethod: 'cash',
    paymentState: 'unpaid',
    deliveryAddress: 'Test Simulation St, Cairo',
    deliveryLat: 30.0444,
    deliveryLng: 31.2357,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    items: [
      {
        menuItemId: 'firebase_item_123',
        name: 'Simulation Burger',
        quantity: 2,
        price: 75,
        totalPrice: 150
      }
    ]
  };

  try {
    await db.collection('orders').doc(orderId).set(orderData);
    console.log(`✅ Test order created in Firebase: ${orderId}`);
    console.log('📡 Now check the Vendor Dashboard or Backend Logs...');
    
    // Wait for sync (usually 1-2 seconds)
    setTimeout(() => {
        console.log('🏁 Verification script finished.');
        process.exit(0);
    }, 5000);

  } catch (error) {
    console.error('❌ Error creating test order:', error);
    process.exit(1);
  }
}

simulateFirebaseOrder();
