const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// IDs extracted from test data
const VENDOR_ID = '06fb7436-cbb2-4c99-9fda-1ab6db6d8f41';
const CUSTOMER_ID = '4b146d23-8089-4162-b611-0b7f50c32c98';
const FOOD_ITEM_ID = 'bd59601d-008c-40f3-b8d0-90fc0f7f98e4';
const DRIVER_USER_ID = '58459166-449b-4681-a6e0-a3a1a693b162';

const LEDGER_SECRET = process.env.LEDGER_SECRET || 'z-speed-default-ledger-secret-123';

function signLedgerEntry(data) {
  const payload = `${data.userId}:${data.orderId || ''}:${data.type}:${data.amount.toFixed(4)}`;
  return crypto.createHmac('sha256', LEDGER_SECRET).update(payload).digest('hex');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function interactiveSimulation() {
  console.log('🚀 Starting Interactive Order Simulation (with Ledger Tracking)...');

  try {
    // 0. Find correct restaurant
    const vendor = await prisma.user.findUnique({
      where: { id: VENDOR_ID },
      include: { ownedRestaurants: true }
    });
    
    if (!vendor || vendor.ownedRestaurants.length === 0) {
      throw new Error('Vendor or restaurants not found');
    }

    const restaurant = vendor.ownedRestaurants[0];
    console.log(`📍 Using Restaurant: ${restaurant.name} (ID: ${restaurant.id})`);

    // 1. Create an Order (Customer Action)
    console.log('\n🛒 Step 1: Creating a test order for your dashboard...');
    const order = await prisma.order.create({
      data: {
        customerId: CUSTOMER_ID,
        restaurantId: restaurant.id,
        status: 'PENDING',
        subtotal: 165,
        deliveryFee: 20,
        serviceFee: 5,
        total: 190,
        appCommission: 16.5,
        restaurantShare: 148.5,
        driverShare: 15,
        appShare: 26.5,
        paymentMethod: 'CASH',
        deliveryAddress: 'Cairo, Egypt (Ledger Test)',
        deliveryLat: 30.0444,
        deliveryLng: 31.2357,
        items: {
          create: [{
            foodItemId: FOOD_ITEM_ID,
            quantity: 1,
            unitPrice: 165
          }]
        }
      }
    });
    console.log(`✅ Order Created! ID: ${order.id}`);

    // 2. Poll for status change to READY
    let currentOrder = order;
    while (currentOrder.status !== 'READY') {
      console.log(`⏳ Waiting for Vendor to mark as READY... Status: ${currentOrder.status}`);
      await sleep(3000);
      currentOrder = await prisma.order.findUnique({ where: { id: order.id } });
      if (currentOrder.status === 'CANCELLED' || currentOrder.status === 'REJECTED') return;
    }

    // 3. Driver Pickup
    const driver = await prisma.driverProfile.findUnique({ where: { userId: DRIVER_USER_ID } });
    await prisma.order.update({
      where: { id: order.id },
      data: { driverId: driver.id, status: 'OUT_FOR_DELIVERY', driverAssignedAt: new Date() }
    });
    console.log(`✅ Driver Picked up the order!`);
    await sleep(3000);

    // 4. Finalize Delivery & Ledger
    console.log('\n🏁 Step 4: Finalizing Order and Ledger...');
    
    const restaurantShare = 148.5;
    const driverShare = 15;

    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), paymentState: 'PAID' }
      }),
      // Vendor Update
      prisma.restaurant.update({
        where: { id: restaurant.id },
        data: { walletBalance: { increment: restaurantShare }, totalEarnings: { increment: restaurantShare } }
      }),
      prisma.user.update({
        where: { id: VENDOR_ID },
        data: { walletBalance: { increment: restaurantShare } }
      }),
      // Vendor Ledger Entry
      prisma.ledger.create({
        data: {
          userId: VENDOR_ID,
          orderId: order.id,
          type: 'EARNING',
          amount: restaurantShare,
          status: 'completed',
          signature: signLedgerEntry({ userId: VENDOR_ID, orderId: order.id, type: 'EARNING', amount: restaurantShare })
        }
      }),
      // Driver Update
      prisma.driverProfile.update({
        where: { id: driver.id },
        data: { totalEarnings: { increment: driverShare }, totalTrips: { increment: 1 } }
      }),
      prisma.user.update({
        where: { id: DRIVER_USER_ID },
        data: { walletBalance: { increment: driverShare } }
      }),
      // Driver Ledger Entry
      prisma.ledger.create({
        data: {
          userId: DRIVER_USER_ID,
          orderId: order.id,
          type: 'EARNING',
          amount: driverShare,
          status: 'completed',
          signature: signLedgerEntry({ userId: DRIVER_USER_ID, orderId: order.id, type: 'EARNING', amount: driverShare })
        }
      })
    ]);

    console.log(`💰 Final Balance updated for Vendor and Driver.`);
    console.log(`✅ Ledger entries created (Transactions will now appear in UI).`);
    console.log('\n✨ Simulation Completed!');

  } catch (error) {
    console.error('\n❌ Simulation Failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

interactiveSimulation();
