import { PrismaClient, Role, AccountStatus } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadToCloudinary(url: string | null | undefined, folder: string) {
  if (!url || !url.startsWith('http')) return null;
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    const buffer = Buffer.from(response.data);
    const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(base64, { folder });
    return result.secure_url;
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log('Starting report generation...');
  const filePath = '/home/omar/Desktop/Z-SPEED/zspeed-1777924034_new.json';
  const rawData = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(rawData);
  const collections = json.data.__collections__;

  const restaurants = collections.restaurants || {};
  const applications = collections.applications || {};
  
  const logins: any[] = [];

  // Process Restaurants
  for (const [id, resData] of Object.entries(restaurants) as any) {
    await processRestaurant(id, resData, logins);
  }

  // Process Applications
  for (const [id, appData] of Object.entries(applications) as any) {
    if (appData.applicationType === 'restaurant') {
       const mappedData = {
          name: appData.formData?.businessInfo?.restaurantName,
          ownerEmail: appData.formData?.contactInfo?.ownerEmail,
          logoUrl: appData.formData?.branding?.logoUrl,
          coverImageUrl: appData.formData?.branding?.coverUrl,
          __collections__: appData.__collections__
       };
       await processRestaurant(id, mappedData, logins);
    }
  }

  // Write logins.txt
  let loginsText = 'RESTAURANT LOGINS (PRODUCTION DATA)\n====================================\n\n';
  logins.forEach(l => {
    loginsText += `Restaurant: ${l.restaurantName}\nEmail: ${l.email}\nPassword: ${l.password}\nID: ${l.restaurantId}\n-----------------\n`;
  });
  fs.writeFileSync('scripts/logins.txt', loginsText);

  console.log('Final migration report generated in scripts/logins.txt');
}

async function processRestaurant(id: string, resData: any, logins: any[]) {
  try {
    const name = resData.name || resData.restaurantName;
    if (!name) return;

    console.log(`Processing: ${name}`);
    
    const ownerEmail = resData.ownerEmail || `vendor_${id.toLowerCase()}@zspeed.app`;
    const password = `ZSpeed@${Math.random().toString(36).slice(-8)}`;
    
    // 1. Create/Update User in Supabase
    let supabaseId: string;
    const { data: sbUser, error: sbError } = await supabase.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { name: name, role: Role.VENDOR }
    });

    if (sbError) {
      if (sbError.message.includes('already been registered')) {
        const { data: existing } = await supabase.auth.admin.listUsers();
        const user = existing.users.find(u => u.email === ownerEmail);
        supabaseId = user!.id;
        // Reset password so we know it
        await supabase.auth.admin.updateUserById(supabaseId, { password });
      } else {
        return;
      }
    } else {
      supabaseId = sbUser.user.id;
    }

    // 2. Create/Update User in Prisma
    const user = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: { supabaseId, role: Role.VENDOR },
      create: {
        email: ownerEmail,
        name: name,
        role: Role.VENDOR,
        supabaseId,
        authProvider: 'email',
        emailVerified: true,
        status: AccountStatus.ACTIVE,
      }
    });

    // 3. Create/Update Restaurant
    const existingRes = await prisma.restaurant.findFirst({ where: { name } });
    let restaurant;
    if (existingRes) {
      restaurant = existingRes;
      console.log(`- ${name} already exists, updated owner password.`);
    } else {
      const logoUrl = await uploadToCloudinary(resData.logoUrl, 'restaurants/logos');
      const coverUrl = await uploadToCloudinary(resData.coverImageUrl, 'restaurants/covers');
      restaurant = await prisma.restaurant.create({
        data: {
          ownerId: user.id,
          name: name,
          logoUrl,
          coverImageUrl: coverUrl,
          isActive: true,
          isOpen: true,
          status: AccountStatus.ACTIVE,
        }
      });
      // Process menu for new ones... (simplified for this report run)
    }

    logins.push({
      restaurantName: restaurant.name,
      email: ownerEmail,
      password: password,
      restaurantId: restaurant.id
    });
  } catch (err) {
    console.error(`Error processing ${id}:`, err);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
