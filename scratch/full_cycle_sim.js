const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');
const serviceAccount = require('/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json');

const prisma = new PrismaClient();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function fullCycleSimulation() {
  console.log('🚀 Starting Full Lifecycle Simulation...');
  
  // 1. Create Order in Firebase
  const orderId = `SIM_${Date.now()}`;
  const orderData = {
    customerId: 'UlZEznsHHdOq9M82ERxxYsEgMbx1',
    restaurantId: 'iBse6IVbrN53QikUkpqo',
    status: 'pending',
    subtotal: 250,
    deliveryFee: 20,
    serviceFee: 10,
    total: 280,
    paymentMethod: 'cash',
    paymentState: 'unpaid',
    deliveryAddress: 'Simulation Tower, Floor 10',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    items: [
      {
        menuItemId: 'sim_item_999',
        name: 'Grand Z-Burger',
        quantity: 1,
        price: 250,
      }
    ]
  };

  await db.collection('orders').doc(orderId).set(orderData);
  console.log(`\n📦 STEP 1: Order created in Firebase: ${orderId}`);
  console.log('👉 ACTION REQUIRED: Log in to Dashboard as test_vendor@zspeed.app and update status to READY.');

  // 2. Wait and Listen for Status Change in SQL
  console.log('⏳ Waiting for you to update status in the Dashboard...');
  
  let isReady = false;
  let sqlOrder = null;

  while (!isReady) {
    sqlOrder = await prisma.order.findUnique({
      where: { firebaseOrderId: orderId },
      include: { customer: true }
    });

    if (sqlOrder && sqlOrder.status === 'READY') {
      isReady = true;
      console.log('\n✅ STEP 2: I detected you marked the order as READY!');
    } else if (sqlOrder) {
       process.stdout.write(`\rCurrent SQL Status: ${sqlOrder.status} ... `);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Act as Driver
  console.log('\n🛵 STEP 3: Acting as Driver (Captain Z-SPEED)...');
  
  const driver = await prisma.user.findUnique({ where: { email: 'test_driver@zspeed.app' } });
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId: driver.id } });

  console.log('Assigning Driver...');
  await prisma.order.update({
    where: { id: sqlOrder.id },
    data: { driverId: driverProfile.id, status: 'PICKED_UP' }
  });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Arriving at destination...');
  await prisma.order.update({
    where: { id: sqlOrder.id },
    data: { status: 'ARRIVED' }
  });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Delivering order...');
  await prisma.order.update({
    where: { id: sqlOrder.id },
    data: { status: 'DELIVERED', paymentState: 'PAID' }
  });

  console.log('\n🎉 SUCCESS: Order Lifecycle Completed!');
  console.log('Check your Dashboard Wallet, you should see the earnings!');
  process.exit(0);
}

fullCycleSimulation().catch(console.error);
