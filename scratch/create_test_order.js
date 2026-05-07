const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const driverProfileId = '4c89f904-ed32-427d-9231-f05eb80e93c6'; // CORRECT ID
  const restaurantId = '1e761a64-dbd2-4390-899a-ed61f209492a';
  const customerId = 'ea0c2c7c-be1a-45b0-ba22-5b01961c4a3e';

  // 1. Create an order
  const order = await prisma.order.create({
    data: {
      customerId,
      restaurantId,
      status: 'CONFIRMED',
      subtotal: 150.0,
      deliveryFee: 25.0,
      serviceFee: 5.0,
      total: 180.0,
      paymentMethod: 'CASH',
      deliveryAddress: 'Test Address 123, Cairo',
      deliveryLat: 30.0444,
      deliveryLng: 31.2357,
    }
  });
  console.log('Order created:', order.id);

  // 2. Create a delivery request for the driver
  const deliveryRequest = await prisma.deliveryRequest.create({
    data: {
      orderId: order.id,
      driverId: driverProfileId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 1000 * 60 * 30), // 30 mins
      deliveryFee: 25.0,
      estimatedDistance: 3.5,
    }
  });
  console.log('Delivery request created:', deliveryRequest.id);
  console.log('Test setup complete. Check the driver app dashboard for a new request!');
}

main();
