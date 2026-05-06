import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

async function fixPermissions() {
  const serviceAccountPath = path.join(__dirname, '../../FIREBASE-KEY.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('FIREBASE-KEY.json not found at:', serviceAccountPath);
    return;
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  const db = admin.firestore();
  const drivers = await db.collection('driverProfiles').get();
  
  console.log(`Found ${drivers.size} drivers to update.`);

  for (const driverDoc of drivers.docs) {
    const data = driverDoc.data();
    const uid = driverDoc.id;
    console.log(`Fixing permissions for driver: ${data.email || uid}`);
    
    // 1. Create/Update user doc
    await db.collection('users').doc(uid).set({
      uid: uid,
      name: data.name || 'Captain',
      email: data.email || '',
      phone: data.phone || '',
      role: 'DRIVER',
      userType: 'driver',
      createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // 2. Update driver profile
    await db.collection('driverProfiles').doc(uid).update({
      status: 'online',
      online: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  console.log('✅ Done! All drivers updated.');
}

fixPermissions().catch(console.error);
