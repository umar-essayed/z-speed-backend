const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const email = 'vendor@test.com';
  const password = 'password123';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'VENDOR',
      status: 'ACTIVE'
    },
    create: {
      email,
      name: 'Test Vendor',
      passwordHash,
      role: 'VENDOR',
      status: 'ACTIVE',
      emailVerified: true
    }
  });

  // Create a restaurant for this vendor
  const restaurant = await prisma.restaurant.create({
    data: {
      ownerId: user.id,
      name: 'Test Restaurant',
      address: 'Cairo, Egypt',
      city: 'Cairo',
      latitude: 30.0444,
      longitude: 31.2357,
      isActive: true,
      isOpen: true,
      status: 'ACTIVE',
      deliveryFee: 15,
      deliveryTimeMin: 20,
      deliveryTimeMax: 40,
      minimumOrder: 50,
      deliveryRadiusKm: 10,
      vendorType: 'Fast Food'
    }
  });

  // Create a menu section
  const section = await prisma.menuSection.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Main Dishes',
      nameAr: 'الأطباق الرئيسية',
      sortOrder: 1
    }
  });

  // Create a food item
  await prisma.foodItem.create({
    data: {
      sectionId: section.id,
      name: 'Classic Burger',
      description: 'Delicious beef burger',
      price: 120,
      isAvailable: true,
      imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500'
    }
  });

  console.log(`Vendor created: ${email} / ${password}`);
  console.log(`Restaurant ID: ${restaurant.id}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
