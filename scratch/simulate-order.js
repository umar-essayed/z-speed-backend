const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// IDs extracted from test data
const CUSTOMER_ID = '4b146d23-8089-4162-b611-0b7f50c32c98';
const RESTAURANT_ID = '298414ff-5822-4a5c-bef1-5e335b2a5c0f';
const FOOD_ITEM_ID = 'bd59601d-008c-40f3-b8d0-90fc0f7f98e4';
const DRIVER_USER_ID = '58459166-449b-4681-a6e0-a3a1a693b162';

async function simulateOrderFlow() {
  console.log('🚀 Starting Full Order Flow Simulation...');

  try {
    // 1. Check current balances
    const initialRestaurant = await prisma.restaurant.findUnique({ where: { id: RESTAURANT_ID } });
    console.log(`\n📊 Initial Vendor Balance: ${initialRestaurant.walletBalance} EGP`);

    // 2. Create an Order (Customer Action)
    console.log('\n🛒 Step 1: Customer placing an order...');
    const order = await prisma.order.create({
      data: {
        customerId: CUSTOMER_ID,
        restaurantId: RESTAURANT_ID,
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
        deliveryAddress: 'Cairo, Egypt (Test Address)',
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
    console.log(`✅ Order Created! ID: ${order.id} | Status: ${order.status}`);

    // 3. Vendor Accepts Order
    console.log('\n👨‍🍳 Step 2: Vendor accepting the order...');
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', acceptedAt: new Date() }
    });
    console.log(`✅ Order Status: CONFIRMED`);

    // 4. Driver Assignment
    console.log('\n🚗 Step 3: Assigning a driver...');
    const driver = await prisma.driverProfile.findUnique({ where: { userId: DRIVER_USER_ID } });
    if (!driver) throw new Error('Driver profile not found');
    
    await prisma.order.update({
      where: { id: order.id },
      data: { 
        driverId: driver.id,
        status: 'PREPARING',
        driverAssignedAt: new Date()
      }
    });
    console.log(`✅ Driver Assigned: ${DRIVER_USER_ID} | Status: PREPARING`);

    // 5. Driver Picks Up
    console.log('\n📦 Step 4: Driver picking up the order...');
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'OUT_FOR_DELIVERY' }
    });
    console.log(`✅ Order Status: OUT_FOR_DELIVERY`);

    // 6. Driver Delivers (Final Step & Wallet Update)
    console.log('\n🏁 Step 5: Driver delivered the order (Processing Payment)...');
    
    await prisma.$transaction([
      // Update Order Status
      prisma.order.update({
        where: { id: order.id },
        data: { 
          status: 'DELIVERED',
          deliveredAt: new Date(),
          paymentState: 'PAID'
        }
      }),
      // Update Restaurant Wallet
      prisma.restaurant.update({
        where: { id: RESTAURANT_ID },
        data: { 
          walletBalance: { increment: order.restaurantShare },
          totalEarnings: { increment: order.restaurantShare }
        }
      }),
      // Update Driver Profile Stats
      prisma.driverProfile.update({
        where: { id: driver.id },
        data: { 
          totalEarnings: { increment: order.driverShare },
          totalTrips: { increment: 1 }
        }
      }),
      // Update Driver User Wallet
      prisma.user.update({
        where: { id: DRIVER_USER_ID },
        data: {
          walletBalance: { increment: order.driverShare }
        }
      })
    ]);
    console.log(`✅ Order Status: DELIVERED`);

    // 7. Verify Final Balances
    const finalRestaurant = await prisma.restaurant.findUnique({ where: { id: RESTAURANT_ID } });
    console.log(`\n💰 Final Vendor Balance: ${finalRestaurant.walletBalance} EGP`);
    console.log(`📈 Net Change: +${finalRestaurant.walletBalance - initialRestaurant.walletBalance} EGP`);

    console.log('\n✨ Simulation Completed Successfully!');
  } catch (error) {
    console.error('\n❌ Simulation Failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

simulateOrderFlow();
