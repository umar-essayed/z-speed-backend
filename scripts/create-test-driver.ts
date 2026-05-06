import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

async function createTestDriver() {
  const serviceAccount = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../FIREBASE-KEY.json'), 'utf8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  const email = 'driver@zspeed.com';
  const password = '123456';

  try {
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log('User already exists, updating...');
      await admin.auth().updateUser(user.uid, { password });
    } catch (e) {
      user = await admin.auth().createUser({
        email,
        password,
        displayName: 'Captain Z-Speed',
      });
      console.log('Created new auth user:', user.uid);
    }

    // Create Driver Profile
    await admin.firestore().collection('driverProfiles').doc(user.uid).set({
      userId: user.uid,
      name: 'Captain Z-Speed',
      email: email,
      status: 'online',
      phone: '01000000000',
      vehicleType: 'bike',
      walletBalance: 0,
      rating: 5.0,
      totalTrips: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`✅ Success! Use these credentials: \nEmail: ${email}\nPassword: ${password}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createTestDriver();
