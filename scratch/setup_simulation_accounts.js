const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTestAccounts() {
  console.log('👷 Creating Test Accounts for Simulation...');

  // 1. Create Test Vendor (Restaurant Owner)
  const vendorUser = await prisma.user.upsert({
    where: { email: 'test_vendor@zspeed.app' },
    update: {},
    create: {
      email: 'test_vendor@zspeed.app',
      name: 'Test Restaurant Owner',
      role: 'VENDOR',
      status: 'ACTIVE',
      firebaseUid: 'VND_TEST_001'
    }
  });

  const restaurant = await prisma.restaurant.upsert({
    where: { firebaseId: 'iBse6IVbrN53QikUkpqo' }, // Linked to Firebase test restaurant
    update: { ownerId: vendorUser.id },
    create: {
      firebaseId: 'iBse6IVbrN53QikUkpqo',
      ownerId: vendorUser.id,
      name: 'Z-SPEED Test Kitchen',
      isActive: true,
      isOpen: true,
      status: 'ACTIVE',
      address: 'Simulated HQ, Cairo',
      latitude: 30.0444,
      longitude: 31.2357,
    }
  });

  // 2. Create Test Customer
  const customer = await prisma.user.upsert({
    where: { email: 'test_customer@zspeed.app' },
    update: {},
    create: {
      email: 'test_customer@zspeed.app',
      name: 'Omar Test Customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      firebaseUid: 'UlZEznsHHdOq9M82ERxxYsEgMbx1' // Matches your Firebase Key analysis
    }
  });

  // 3. Create Test Driver
  const driverUser = await prisma.user.upsert({
    where: { email: 'test_driver@zspeed.app' },
    update: {},
    create: {
      email: 'test_driver@zspeed.app',
      name: 'Captain Z-SPEED',
      role: 'DRIVER',
      status: 'ACTIVE',
    }
  });

  const driverProfile = await prisma.driverProfile.upsert({
    where: { userId: driverUser.id },
    update: { isAvailable: true },
    create: {
      userId: driverUser.id,
      applicationStatus: 'APPROVED',
      isAvailable: true,
      currentLat: 30.0444,
      currentLng: 31.2357,
    }
  });

  console.log('✅ Test accounts created successfully!');
  console.log(`- Vendor Email: ${vendorUser.email}`);
  console.log(`- Customer Email: ${customer.email}`);
  console.log(`- Driver Email: ${driverUser.email}`);
  console.log(`- Restaurant ID: ${restaurant.id}`);
}

createTestAccounts().catch(console.error).finally(() => prisma.$disconnect());
