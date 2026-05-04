import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPoints(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { loyaltyPoints: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async addPoints(userId: string, amount: number) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { loyaltyPoints: { increment: Math.floor(amount) } },
    });
  }

  async redeemPoints(userId: string, points: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.loyaltyPoints < points) {
      throw new BadRequestException('Insufficient loyalty points');
    }

    // Load redemption rate from config
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
    });
    const rate = config?.loyaltyPointsRedeemRate ?? 0.01;
    const discountAmount = Math.round(points * rate * 100) / 100;

    await this.prisma.user.update({
      where: { id: userId },
      data: { loyaltyPoints: { decrement: points } },
    });

    return { points, discountAmount };
  }
}
