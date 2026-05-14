const axios = require('axios');

async function triggerOtp() {
  const email = 'yijapam424@acanok.com';
  const url = 'http://localhost:3000/api/v1/auth/email/send-otp';

  console.log(`Sending POST request to ${url} with email: ${email}...`);

  try {
    const response = await axios.post(url, { email });
    console.log('✅ Success! Response:', response.data);
  } catch (error) {
    if (error.response) {
      console.error('❌ Failed with status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

triggerOtp();
