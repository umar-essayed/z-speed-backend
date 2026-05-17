import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideStatus } from '@prisma/client';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import * as admin from 'firebase-admin';

@Injectable()
export class TransportService {
  constructor(
    private prisma: PrismaService,
    private firebase: FirebaseAdminService,
  ) {}

  // ── Existing Pricing Configurations ──────────────────────────────────────────

  async getPricing() {
    const db = this.firebase.getFirestore();
    if (!db) return {};
    const doc = await db.collection('configs').doc('transport').get();
    if (doc.exists) {
      return doc.data();
    }
    return {
      sedan_baseFare: 15,
      sedan_pricePerKm: 5,
      moto_baseFare: 10,
      moto_pricePerKm: 3,
      luxury_baseFare: 25,
      luxury_pricePerKm: 8,
    };
  }

  async updatePricing(pricing: any) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firebase Firestore not available');
    const updateData = {
      sedan_baseFare: Number(pricing.sedan_baseFare || 15),
      sedan_pricePerKm: Number(pricing.sedan_pricePerKm || 5),
      moto_baseFare: Number(pricing.moto_baseFare || 10),
      moto_pricePerKm: Number(pricing.moto_pricePerKm || 3),
      luxury_baseFare: Number(pricing.luxury_baseFare || 25),
      luxury_pricePerKm: Number(pricing.luxury_pricePerKm || 8),
      updatedAt: new Date(),
    };
    await db.collection('configs').doc('transport').set(updateData, { merge: true });
    return { success: true, pricing: updateData };
  }

  // ── Production Integrated Gateway Operations ──────────────────────────────────

  private serializeRideDoc(doc: any) {
    const data = doc.data();
    if (!data) return null;
    
    ['requestedAt', 'acceptedAt', 'startedAt', 'completedAt'].forEach(k => {
       if (data[k] && typeof data[k].toDate === 'function') {
         data[k] = data[k].toDate().toISOString();
       }
    });
    if (data.currentDriverLocation && data.currentDriverLocation.timestamp) {
      if (typeof data.currentDriverLocation.timestamp.toDate === 'function') {
        data.currentDriverLocation.timestamp = data.currentDriverLocation.timestamp.toDate().toISOString();
      }
    }
    if (data.pathPoints) {
      data.pathPoints = data.pathPoints.map((p: any) => {
        if (p.timestamp && typeof p.timestamp.toDate === 'function') {
          p.timestamp = p.timestamp.toDate().toISOString();
        }
        return p;
      });
    }
    return { id: doc.id, ...data };
  }

  async createRideGateway(rideData: any) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    const docRef = db.collection('transports').doc();
    const rideId = docRef.id;

    const firestoreData = {
      ...rideData,
      id: rideId,
      status: 'pending',
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      pathPoints: [],
    };

    await docRef.set(firestoreData);

    // SQL mirror to ensure robust unified history
    try {
      await this.prisma.ride.create({
        data: {
          id: rideId,
          customerId: rideData.customerId,
          pickupAddress: rideData.pickupLocation?.address || 'Pickup Location',
          pickupLat: Number(rideData.pickupLocation?.latitude || 0),
          pickupLng: Number(rideData.pickupLocation?.longitude || 0),
          dropoffAddress: rideData.dropoffLocation?.address || 'Dropoff Location',
          dropoffLat: Number(rideData.dropoffLocation?.latitude || 0),
          dropoffLng: Number(rideData.dropoffLocation?.longitude || 0),
          estimatedDistance: 0,
          estimatedFare: Number(rideData.totalFare || 0),
          totalFare: Number(rideData.totalFare || 0),
          type: (rideData.vehicleType || 'SEDAN').toUpperCase() as any,
          status: 'PENDING',
        }
      });
    } catch (err) {
      console.error('Failed to create SQL mirror for ride:', err.message);
    }

    return { success: true, rideId };
  }

  async getRideGateway(rideId: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    const doc = await db.collection('transports').doc(rideId).get();
    if (!doc.exists) {
      return { success: false, error: 'Not found' };
    }
    return { success: true, ride: this.serializeRideDoc(doc) };
  }

  async updateRideGateway(rideId: string, updates: any) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    if (updates.status === 'started' || updates.status === 'completed' || updates.status === 'accepted' || updates.status === 'cancelled') {
       const key = updates.status === 'started' ? 'startedAt' : 
                   updates.status === 'completed' ? 'completedAt' : 
                   updates.status === 'accepted' ? 'acceptedAt' : 'completedAt';
       updates[key] = admin.firestore.FieldValue.serverTimestamp();
    }

    const rideRef = db.collection('transports').doc(rideId);
    const rideSnap = await rideRef.get();
    const ride = rideSnap.data();

    if (updates.status === 'completed' && ride && ride.driverId && ride.status !== 'completed') {
      const driverId = ride.driverId;
      const totalFare = Number(ride.totalFare || 0);

      // 1. Update driver profile in Firestore
      await db.collection('driverProfiles').doc(driverId).set({
        totalEarnings: admin.firestore.FieldValue.increment(totalFare),
        walletBalance: admin.firestore.FieldValue.increment(totalFare),
        totalTrips: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 2. Create transaction document in Firestore
      const txId = db.collection('driverWalletTransactions').doc().id;
      await db.collection('driverWalletTransactions').doc(txId).set({
        driverId: driverId,
        orderId: rideId,
        type: 'credit',
        amount: totalFare,
        description: 'Transport ride completed successfully',
        status: 'confirmed',
        confirmedByDriver: true,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 3. Update driver in PostgreSQL
      try {
        const driverUser = await this.prisma.user.findFirst({
          where: { firebaseUid: driverId },
          include: { driverProfile: true },
        });
        if (driverUser) {
          await this.prisma.user.update({
            where: { id: driverUser.id },
            data: { walletBalance: { increment: totalFare } },
          });
          if (driverUser.driverProfile) {
            await this.prisma.driverProfile.update({
              where: { id: driverUser.driverProfile.id },
              data: {
                totalEarnings: { increment: totalFare },
                totalTrips: { increment: 1 },
              },
            });
          }
        }
      } catch (sqlErr) {
        console.error('Failed to settle SQL wallet earnings for driver:', sqlErr.message);
      }
    }

    if (updates.status === 'accepted' && updates.driverId) {
      const driverSnap = await db.collection('driverProfiles').doc(updates.driverId).get();
      if (driverSnap.exists) {
        const driverData = driverSnap.data();
        const lat = driverData?.currentLat || 30.0444;
        const lng = driverData?.currentLng || 31.2357;
        updates.currentDriverLocation = {
          latitude: lat,
          longitude: lng,
          address: 'Driver Location',
          timestamp: new Date().toISOString()
        };
      }
    }

    // Sync state update to PostgreSQL
    try {
      const sqlStatus = updates.status === 'pending' ? 'PENDING' :
                        updates.status === 'accepted' ? 'ACCEPTED' :
                        updates.status === 'arrived' ? 'ARRIVED' :
                        updates.status === 'started' ? 'STARTED' :
                        updates.status === 'completed' ? 'COMPLETED' : 'CANCELLED';

      await this.prisma.ride.update({
        where: { id: rideId },
        data: {
          status: sqlStatus as any,
          ...(updates.driverId && { driverId: updates.driverId }),
          ...(updates.status === 'accepted' && { acceptedAt: new Date() }),
          ...(updates.status === 'started' && { startedAt: new Date() }),
          ...(updates.status === 'completed' && { completedAt: new Date() }),
          ...(updates.status === 'cancelled' && { cancelledAt: new Date() }),
        }
      });
    } catch (err) {
      console.error('Failed to update SQL mirror status:', err.message);
    }

    await rideRef.update(updates);
    return { success: true };
  }

  async updateRideLocationGateway(rideId: string, lat: number, lng: number) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    const point = {
      latitude: Number(lat),
      longitude: Number(lng),
      address: 'Recording...',
      timestamp: new Date()
    };

    await db.collection('transports').doc(rideId).update({
      currentDriverLocation: point,
      pathPoints: admin.firestore.FieldValue.arrayUnion(point),
    });

    return { success: true };
  }

  async getPendingRidesGateway() {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    const q = await db.collection('transports').where('status', '==', 'pending').get();
    const rides = q.docs.map(doc => this.serializeRideDoc(doc)).filter(Boolean);
    return { success: true, rides };
  }

  async getMyRidesGateway(customerId: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    const q = await db.collection('transports').where('customerId', '==', customerId).get();
    const rides = q.docs.map(doc => this.serializeRideDoc(doc)).filter(Boolean);
    rides.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
    return { success: true, rides };
  }

  async getDriverRidesGateway(driverId: string) {
    const db = this.firebase.getFirestore();
    if (!db) throw new Error('Firestore not initialized');

    const q = await db.collection('transports').where('driverId', '==', driverId).get();
    const rides = q.docs.map(doc => this.serializeRideDoc(doc)).filter(Boolean);
    rides.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
    return { success: true, rides };
  }

  // ── Existing PostgreSQL DB Methods ──────────────────────────────────────────

  async createRide(dto: CreateRideDto) {
    return this.prisma.ride.create({
      data: {
        customerId: dto.customerId,
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffAddress: dto.dropoffAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        estimatedDistance: dto.estimatedDistance,
        estimatedFare: dto.estimatedFare,
        totalFare: dto.estimatedFare,
        type: dto.type || 'SEDAN',
        paymentMethod: dto.paymentMethod || 'CASH',
      },
    });
  }

  async findAll() {
    return this.prisma.ride.findMany({
      include: {
        customer: true,
        driver: {
          include: {
            user: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: { customer: true, driver: { include: { user: true } } },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  async updateStatus(id: string, status: RideStatus, driverId?: string) {
    return this.prisma.ride.update({
      where: { id },
      data: {
        status,
        ...(driverId && { driverId }),
        ...(status === RideStatus.ACCEPTED && { acceptedAt: new Date() }),
        ...(status === RideStatus.STARTED && { startedAt: new Date() }),
        ...(status === RideStatus.COMPLETED && { completedAt: new Date() }),
        ...(status === RideStatus.CANCELLED && { cancelledAt: new Date() }),
      },
    });
  }

  async getStats() {
    const rides = await this.prisma.ride.findMany();
    const active = rides.filter(r => r.status !== RideStatus.COMPLETED && r.status !== RideStatus.CANCELLED).length;
    const completed = rides.filter(r => r.status === RideStatus.COMPLETED).length;
    const revenue = rides.filter(r => r.status === RideStatus.COMPLETED).reduce((acc, curr) => acc + curr.totalFare, 0);

    return {
      activeRides: active,
      completedRides: completed,
      totalRevenue: revenue,
    };
  }
}
