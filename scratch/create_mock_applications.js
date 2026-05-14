require('dotenv').config();
const admin = require('firebase-admin');

if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('❌ Firebase credentials not found in .env');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  })
});

const db = admin.firestore();

async function createMockApplications() {
  console.log('🚀 Creating mock applications in Firebase...');

  // 1. Mock Driver Application
  const driverApp = {
    userId: '0f808e41-7731-4403-8137-9931b0f5b2ae',
    name: 'Ahmed Driver Test',
    email: 'ahmed_driver@test.com',
    phone: '01011112222',
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    personal: {
      nationalId: '29901011234567',
      dateOfBirth: '1995-05-15',
    },
    vehicle: {
      type: 'CAR',
      make: 'Toyota',
      model: 'Corolla',
      year: '2023',
      color: 'Silver',
      plateNumber: 'م ص ر 555',
    }
  };

  const driverDoc = await db.collection('driver_applications').add(driverApp);
  console.log('✅ Driver application created with ID:', driverDoc.id);

  // 2. Mock Vendor Application (Restaurant)
  const vendorApp = {
    userId: '1adf4279-226f-4424-b734-c980a32d9ab2',
    businessName: 'Z-Burger House',
    name: 'Omar Owner Test',
    email: 'omar_vendor@test.com',
    phone: '01122334455',
    status: 'pending',
    vendorType: 'RESTAURANT',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    city: 'Cairo',
    address: 'Nasr City',
    ownerName: 'Omar Essayed'
  };

  const vendorDoc = await db.collection('vendor_applications').add(vendorApp);
  console.log('✅ Vendor application created with ID:', vendorDoc.id);

  console.log('\n✨ Mock applications injected! Go to Admin Panel to see them.');
}

createMockApplications().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
