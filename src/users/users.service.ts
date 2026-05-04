import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto, CreateAddressDto, UpdateAddressDto } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: { addresses: true, driverProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Security: exclude sensitive fields
    const { passwordHash, refreshTokenHash, ...safeUser } = user as any;
    return safeUser;
  }

  async updateProfile(userId: string, data: UpdateProfileDto) {
    const oldUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!oldUser) throw new NotFoundException('User not found');

    const updateData: any = { ...data };

    // If sensitive data changes, reset verification status
    if (data.email && data.email !== oldUser.email) {
      updateData.emailVerified = false;
    }
    if (data.phone && data.phone !== oldUser.phone) {
      updateData.phoneVerified = false;
      updateData.isPhoneVerified = false;
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    if (oldUser && oldUser.name !== user.name) {
      await this.syncUserNameInOrders(userId);
    }

    // Security: exclude sensitive fields
    const { passwordHash, refreshTokenHash, ...safeUser } = user as any;
    return safeUser;
  }

  /**
   * In Firebase this denormalized customerName across active orders.
   * In PostgreSQL (Prisma), the DB is normalized, so this is mostly a no-op 
   * or can be used if we need to notify vendors of the name change.
   */
  async syncUserNameInOrders(userId: string) {
    // No-op for Postgres because Order belongsTo User
    return;
  }

  async addAddress(userId: string, data: CreateAddressDto) {
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({
      data: { ...data, userId },
    });
  }

  async getAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: { isDefault: 'desc' },
    });
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressDto) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return this.prisma.address.update({
      where: { id: addressId },
      data,
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return this.prisma.address.delete({ where: { id: addressId } });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    await this.prisma.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
    return this.prisma.address.update({
      where: { id: addressId },
      data: { isDefault: true },
    });
  }
}
