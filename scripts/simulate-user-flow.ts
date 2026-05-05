import axios from 'axios';
import * as readline from 'readline';

const API_BASE_URL = 'http://localhost:3000/api/v1';
const TEST_EMAIL = 'ozex.ceo@gmail.com';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function simulate() {
  console.log(`\n🚀 Starting user simulation for: ${TEST_EMAIL}`);
  console.log('--------------------------------------------------');

  try {
    // 1. Send OTP
    console.log(`1. Requesting OTP for ${TEST_EMAIL}...`);
    const sendOtpRes = await axios.post(`${API_BASE_URL}/auth/email/send-otp`, {
      email: TEST_EMAIL,
    });
    console.log('✅ Response:', sendOtpRes.data.message);

    console.log('\n📩 Please check your email (support@zspeedapp.com) and find the verification code.');
    const code = await question('👉 Enter the 6-digit verification code: ');

    // 2. Verify OTP
    console.log(`\n2. Verifying code ${code}...`);
    try {
      const verifyRes = await axios.post(`${API_BASE_URL}/auth/email/verify-otp`, {
        email: TEST_EMAIL,
        code: code,
      });
      console.log('✅ Verification Status:', verifyRes.data.message);
      
      if (verifyRes.data.user) {
        console.log('👤 User details:', verifyRes.data.user);
      }
    } catch (err: any) {
      console.error('❌ Verification failed:', err.response?.data?.message || err.message);
      rl.close();
      return;
    }

    // 3. Register if needed (or just show registration step)
    console.log('\n3. Simulating full registration (password creation)...');
    const name = await question('👤 Enter your name: ');
    const password = await question('🔐 Enter your password: ');

    try {
      const registerRes = await axios.post(`${API_BASE_URL}/auth/email/register`, {
        email: TEST_EMAIL,
        password: password,
        name: name,
        role: 'CUSTOMER',
      });
      console.log('\n🎉 Registration SUCCESS!');
      console.log('--------------------------------------------------');
      console.log('Response Message:', registerRes.data.message);
      console.log('User ID:', registerRes.data.user?.id);
      console.log('Access Token:', registerRes.data.accessToken?.substring(0, 20) + '...');
    } catch (err: any) {
      if (err.response?.status === 409) {
        console.log('\nℹ️ User already registered. Trying login instead...');
        const loginRes = await axios.post(`${API_BASE_URL}/auth/email/login`, {
          email: TEST_EMAIL,
          password: password,
        });
        console.log('✅ Login SUCCESS!');
        console.log('Access Token:', loginRes.data.accessToken?.substring(0, 20) + '...');
      } else {
        console.error('❌ Registration failed:', err.response?.data?.message || err.message);
      }
    }

  } catch (error: any) {
    console.error('❌ Error during simulation:', error.response?.data?.message || error.message);
  } finally {
    rl.close();
  }
}

simulate();
