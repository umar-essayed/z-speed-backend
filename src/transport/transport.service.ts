import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideStatus } from '@prisma/client';

@Injectable()
export class TransportService {
  constructor(private prisma: PrismaService) {}

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
        totalFare: dto.estimatedFare, // Initial total fare is estimated
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
