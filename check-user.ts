import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("=== DB REALISTIC ALIGNMENT START ===");
  
  const firebaseUid = 'QPBzlOR8WKb8APfi8iBflXHh2ml2';
  const pgRestaurantId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16'; // VALID UUID FOR BACKEND PIPES!
  
  // 1. Ensure the Vendor User exists in Postgres
  let user = await prisma.user.findUnique({
    where: { id: firebaseUid }
  });
  
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: firebaseUid,
        firebaseUid: firebaseUid,
        email: 'pharmacy_owner_direct@zspeed.com',
        name: 'Pharmacy Direct Owner',
        role: 'VENDOR',
        status: 'ACTIVE'
      }
    });
  }
  console.log("Aligned Vendor User ID:", user.id);

  // Clean any old QPBzlOR8WKb8APfi8iBflXHh2ml2 restaurant if exists to prevent conflicts
  try {
    await prisma.restaurant.delete({
      where: { id: firebaseUid }
    });
    console.log("Cleaned up temporary QPBzlOR8WKb8APfi8iBflXHh2ml2 restaurant.");
  } catch (e) {}

  // 2. Ensure the Restaurant exists with PG id as UUID and firebaseId as Vendor UID
  let rest = await prisma.restaurant.findUnique({
    where: { id: pgRestaurantId }
  });
  
  if (!rest) {
    rest = await prisma.restaurant.create({
      data: {
        id: pgRestaurantId,
        ownerId: firebaseUid,
        name: 'Z-SPEED Premium Pharmacy',
        nameAr: 'صيدلية زد سبيد الفاخرة',
        firebaseId: firebaseUid, // MUST MATCH VENDOR UID TO COMPLY WITH FIRESTORE SECURITY RULES!
        vendorType: 'pharmacy',
        status: 'ACTIVE',
        isActive: true,
        isOpen: true,
        address: 'Tahrir Square, Downtown Cairo',
        city: 'Cairo',
        latitude: 30.0444,
        longitude: 31.2357,
        deliveryRadiusKm: 15,
        deliveryTimeMin: 20,
        deliveryTimeMax: 45,
        deliveryFeeMode: 'fixed',
        deliveryFee: 15,
        minimumOrder: 50,
        autoAcceptOrders: true,
        notificationsEnabled: true
      }
    });
  } else {
    // update to ensure correct mapping and status
    await prisma.restaurant.update({
      where: { id: pgRestaurantId },
      data: {
        firebaseId: firebaseUid,
        isActive: true,
        isOpen: true,
        status: 'ACTIVE'
      }
    });
  }
  console.log("Aligned Restaurant - Postgres UUID:", rest.id, "Firebase ID:", firebaseUid);

  // 3. Find customer by firebaseUid
  const targetFirebaseUid = 'tpsumw3PcFUUHLy4m1kXSgoZZ1v1';
  let customer = await prisma.user.findFirst({
    where: { firebaseUid: targetFirebaseUid }
  });
  
  if (!customer) {
    console.log("Customer not found. Creating customer...");
    customer = await prisma.user.create({
      data: {
        firebaseUid: targetFirebaseUid,
        email: 'customer_real_test@zspeed.com',
        name: 'حواوشي',
        role: 'CUSTOMER',
        status: 'ACTIVE'
      }
    });
  }
  console.log("Aligned Customer User ID in Postgres:", customer.id);

  // 4. Delete all existing prescriptions to refresh properly
  await prisma.prescriptionRequest.deleteMany({});
  console.log("Cleared old prescriptions.");

  // 5. Create REALISTIC Prescriptions with ID matching their real Firestore Document IDs
  // Real Prescription 1: status = pending
  const p1 = await prisma.prescriptionRequest.create({
    data: {
      id: 'XAR24zXn8JUim7rH67j1', // EXACT Firestore ID
      customerId: customer.id, // Actual Postgres Customer ID mapping
      customerName: 'حواوشي',
      customerPhone: '01127802955',
      restaurantId: firebaseUid, // MUST match the firebaseId (Vendor UID) for Firestore security rules!
      restaurantName: 'Z-SPEED Premium Pharmacy',
      prescriptionImageUrl: 'https://res.cloudinary.com/dw3pfhm28/image/upload/v1779216626/z-speed/users/tpsumw3PcFUUHLy4m1kXSgoZZ1v1/prescriptions/file_bzdr1c.png',
      imageUrl: 'https://res.cloudinary.com/dw3pfhm28/image/upload/v1779216626/z-speed/users/tpsumw3PcFUUHLy4m1kXSgoZZ1v1/prescriptions/file_bzdr1c.png',
      status: 'pending',
      chatId: `chat_cust_${targetFirebaseUid}_pharm_${firebaseUid}`, // Matches Firestore security rules exactly
      subtotal: null,
      deliveryFee: 15.0,
      tax: null,
      serviceFee: 5.0,
      total: null,
      items: []
    }
  });

  // Real Prescription 2: status = chatting (Reviewing state)
  const p2 = await prisma.prescriptionRequest.create({
    data: {
      id: 'eLWv6EC6AthYYwjDR3Za', // EXACT Firestore ID
      customerId: customer.id, // Actual Postgres Customer ID mapping
      customerName: 'حواوشي',
      customerPhone: '01127802955',
      restaurantId: firebaseUid, // MUST match the firebaseId (Vendor UID) for Firestore security rules!
      restaurantName: 'Z-SPEED Premium Pharmacy',
      prescriptionImageUrl: 'https://res.cloudinary.com/dw3pfhm28/image/upload/v1779127551/z-speed/users/tpsumw3PcFUUHLy4m1kXSgoZZ1v1/prescriptions/file_k41ouh.jpg',
      imageUrl: 'https://res.cloudinary.com/dw3pfhm28/image/upload/v1779127551/z-speed/users/tpsumw3PcFUUHLy4m1kXSgoZZ1v1/prescriptions/file_k41ouh.jpg',
      status: 'chatting',
      chatId: `chat_cust_${targetFirebaseUid}_pharm_${firebaseUid}`, // Matches Firestore security rules exactly
      subtotal: null,
      deliveryFee: 15.0,
      tax: null,
      serviceFee: 5.0,
      total: null,
      items: []
    }
  });

  console.log("Successfully created real synced prescriptions:");
  console.log("- Presc 1 (Pending): ID =", p1.id, "chatId =", p1.chatId);
  console.log("- Presc 2 (Chatting/Reviewing): ID =", p2.id, "chatId =", p2.chatId);
  console.log("=== DB REALISTIC ALIGNMENT END ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
