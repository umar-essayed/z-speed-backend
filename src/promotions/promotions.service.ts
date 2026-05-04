import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromoDto, UpdatePromoDto } from './dto';

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePromoDto) {
    const existing = await this.prisma.promotion.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new BadRequestException('Promo code already exists');

    return this.prisma.promotion.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
  }

  async findAll() {
    return this.prisma.promotion.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const promo = await this.prisma.promotion.findUnique({
      where: { id },
    });
    if (!promo) throw new NotFoundException('Promo not found');
    return promo;
  }

  async update(id: string, dto: UpdatePromoDto) {
    await this.findOne(id);
    const data: any = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);

    return this.prisma.promotion.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.promotion.delete({
      where: { id },
    });
  }

  async validate(code: string, subtotal: number, customerId: string) {
    const promo = await this.prisma.promotion.findUnique({
      where: { code },
    });

    if (!promo || !promo.isActive) {
      throw new BadRequestException('Invalid or inactive promo code');
    }

    const now = new Date();
    if (now < promo.startDate || now > promo.endDate) {
      throw new BadRequestException('Promo code has expired');
    }

    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
      throw new BadRequestException('Promo code usage limit reached');
    }

    if (subtotal < promo.minOrderAmount) {
      throw new BadRequestException(
        `Minimum order amount to use this code is ${promo.minOrderAmount}`,
      );
    }

    // Check user usage limit accurately
    const userUsageCount = await this.prisma.promotionUsage.count({
      where: {
        userId: customerId,
        promotionId: promo.id,
      },
    });

    if (promo.userUsageLimit && userUsageCount >= promo.userUsageLimit) {
      throw new BadRequestException('You have reached the usage limit for this promo code');
    }

    let discount = 0;
    if (promo.discountType === 'PERCENTAGE') {
      discount = subtotal * (promo.discountValue / 100);
      if (promo.maxDiscount && discount > promo.maxDiscount) {
        discount = promo.maxDiscount;
      }
    } else {
      discount = promo.discountValue;
    }

    return {
      id: promo.id,
      code: promo.code,
      discount: Math.round(discount * 100) / 100,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
    };
  }

  async incrementUsage(code: string) {
    return this.prisma.promotion.update({
      where: { code },
      data: { usageCount: { increment: 1 } },
    });
  }

  // VENDOR METHODS
  async findByRestaurant(restaurantId: string, vendorId: string) {
    await this.verifyOwnership(restaurantId, vendorId);
    return this.prisma.promotion.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createForRestaurant(restaurantId: string, vendorId: string, dto: CreatePromoDto) {
    await this.verifyOwnership(restaurantId, vendorId);
    const existing = await this.prisma.promotion.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new BadRequestException('Promo code already exists');

    return this.prisma.promotion.create({
      data: {
        ...dto,
        restaurantId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
  }

  async updateForRestaurant(id: string, restaurantId: string, vendorId: string, dto: UpdatePromoDto) {
    await this.verifyOwnership(restaurantId, vendorId);
    const promo = await this.prisma.promotion.findFirst({
      where: { id, restaurantId },
    });
    if (!promo) throw new NotFoundException('Promo not found in this restaurant');

    const data: any = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);

    return this.prisma.promotion.update({
      where: { id },
      data,
    });
  }

  async removeForRestaurant(id: string, restaurantId: string, vendorId: string) {
    await this.verifyOwnership(restaurantId, vendorId);
    const promo = await this.prisma.promotion.findFirst({
      where: { id, restaurantId },
    });
    if (!promo) throw new NotFoundException('Promo not found in this restaurant');

    return this.prisma.promotion.delete({
      where: { id },
    });
  }

  private async verifyOwnership(restaurantId: string, vendorId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (restaurant.ownerId !== vendorId) throw new ForbiddenException('Not your restaurant');
  }
}
