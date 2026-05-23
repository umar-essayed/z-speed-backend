import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const projectId = process.env.FIREBASE_PROJECT_ID;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

if (!projectId || !privateKey || !clientEmail) {
  console.error('FIREBASE environment variables are missing!');
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      clientEmail,
    }),
  });
} catch (e) {
  admin.initializeApp();
}

const db = admin.firestore();

async function run() {
  console.log('--- Direct Firebase Check ---');
  const snapshot = await db.collection('driverProfiles').get();
  console.log(`Found ${snapshot.size} driver profiles.`);
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    console.log(`Driver ID: ${doc.id} | Name: ${data.name} | Status: ${data.status} | Lat/Lng: ${data.currentLat},${data.currentLng}`);
  });
  
  console.log('\n--- Transports (Rides) Check ---');
  const rides = await db.collection('transports').orderBy('requestedAt', 'desc').limit(5).get();
  console.log(`Found ${rides.size} recent rides.`);
  rides.docs.forEach(doc => {
    const data = doc.data();
    console.log(`Ride ID: ${doc.id} | Customer: ${data.customerId} (${data.customerName}) | Driver: ${data.driverId} | Status: ${data.status} | Fare: ${data.totalFare}`);
  });

  process.exit(0);
}

run().catch(console.error);
