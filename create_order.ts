import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customerId = 'ea0c2c7c-be1a-45b0-ba22-5b01961c4a3e';
  const restaurantId = '1e761a64-dbd2-4390-899a-ed61f209492a';
  const driverUserId = 'b0544c0b-647c-430e-b047-3713272fadd7';
  const foodItemId = 'e4ff2e47-bb9d-4883-be39-5b7cf1c23205';

  // Get driver profile
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverUserId }
  });

  if (!profile) throw new Error('Driver profile not found');

  const order = await prisma.order.create({
    data: {
      customerId,
      restaurantId,
      driverId: profile.id,
      status: 'OUT_FOR_DELIVERY',
      total: 250.0,
      deliveryFee: 25.0,
      subtotal: 225.0,
      paymentMethod: 'CASH',
      paymentState: 'PENDING',
      deliveryAddress: 'Test Delivery Address, Cairo',
      deliveryLat: 30.0444,
      deliveryLng: 31.2357,
      items: {
        create: [
          {
            foodItemId: foodItemId,
            quantity: 2,
            unitPrice: 112.5
          }
        ]
      }
    }
  });

  console.log('Order created successfully:', order.id);
}

main().catch(console.error).finally(() => prisma.$disconnect());
