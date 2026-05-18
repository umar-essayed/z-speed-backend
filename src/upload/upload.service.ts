import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly prisma: PrismaService,
  ) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'general'): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `z-speed/${folder}`,
          use_filename: true,
          unique_filename: true,
          quality: 'auto:eco', // Maximum compression
          fetch_format: 'auto', // Auto-convert to best format (e.g. webp)
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`);
            return reject(new InternalServerErrorException(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`));
          }
          resolve(result.secure_url);
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  async createPrescriptionChat(data: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    pharmacyId: string;
    pharmacyName: string;
    imageUrl: string;
  }): Promise<{ requestId: string; chatId: string }> {
    const firestore = this.firebaseAdmin.getFirestore();
    if (!firestore) throw new InternalServerErrorException('Firestore not initialized');

    // Fetch proper Firebase IDs from PostgreSQL
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: data.pharmacyId },
      select: { firebaseId: true }
    });
    const fbRestaurantId = restaurant?.firebaseId || data.pharmacyId;

    const user = await this.prisma.user.findUnique({
      where: { id: data.customerId },
      select: { firebaseUid: true }
    });
    const fbCustomerId = user?.firebaseUid || data.customerId;

    const requestRef = firestore.collection('prescription_requests').doc();
    const requestId = requestRef.id;
    // Keep chatId logic consistent using the Firebase IDs
    const chatId = `chat_cust_${fbCustomerId}_pharm_${fbRestaurantId}`;
    const now = new Date();

    // 1. Create Prescription Request in Firestore
    await requestRef.set({
      id: requestId,
      customerId: fbCustomerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      restaurantId: fbRestaurantId,
      restaurantName: data.pharmacyName,
      prescriptionImageUrl: data.imageUrl,
      imageUrl: data.imageUrl, // For backward compatibility with vendor web
      status: 'pending',
      chatId: chatId,
      items: [],
      createdAt: now,
    });

    // 1b. Create Prescription Request in PostgreSQL for vendor-dashboard robustness
    try {
      await this.prisma.prescriptionRequest.create({
        data: {
          id: requestId,
          customerId: fbCustomerId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          restaurantId: fbRestaurantId,
          restaurantName: data.pharmacyName,
          prescriptionImageUrl: data.imageUrl,
          imageUrl: data.imageUrl,
          status: 'pending',
          chatId: chatId,
          items: [],
        }
      });
    } catch (dbErr) {
      this.logger.error(`Failed to save prescription request to PostgreSQL: ${dbErr.message}`);
    }

    // 2. Initialize or Update Chat Session
    const chatRef = firestore.collection('chats').doc(chatId);
    const chatSnapshot = await chatRef.get();
    const lastMsg = 'Prescription uploaded successfully!';

    if (!chatSnapshot.exists) {
      await chatRef.set({
        id: chatId,
        customerId: fbCustomerId,
        customerName: data.customerName,
        restaurantId: fbRestaurantId,
        restaurantName: data.pharmacyName,
        lastMessage: lastMsg,
        lastMessageSenderId: fbCustomerId,
        lastMessageAt: now,
        isOpen: true,
        createdAt: now,
      });
    } else {
      await chatRef.update({
        lastMessage: lastMsg,
        lastMessageSenderId: fbCustomerId,
        lastMessageAt: now,
        isOpen: true,
      });
    }

    // 3. Add first message
    await chatRef.collection('messages').add({
      senderId: fbCustomerId,
      senderRole: 'customer',
      text: 'I uploaded my prescription. Please review it!',
      imageUrl: data.imageUrl,
      createdAt: now,
    });

    return { requestId, chatId };
  }

  async deleteFile(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      this.logger.error(`Cloudinary deletion failed: ${error.message}`);
    }
  }
}
