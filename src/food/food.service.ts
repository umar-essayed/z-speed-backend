import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMenuSectionDto, CreateFoodItemDto } from './dto';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =============================================
  // MENU SECTIONS
  // =============================================

  async createSection(ownerId: string, dto: CreateMenuSectionDto) {
    await this.verifyRestaurantOwnership(dto.restaurantId, ownerId);

    return this.prisma.menuSection.create({
      data: {
        restaurantId: dto.restaurantId,
        name: dto.name,
        nameAr: dto.nameAr,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateSection(
    id: string,
    ownerId: string,
    data: Partial<CreateMenuSectionDto>,
  ) {
    const section = await this.prisma.menuSection.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!section) throw new NotFoundException('Menu section not found');
    if (section.restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }

    return this.prisma.menuSection.update({
      where: { id },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        sortOrder: data.sortOrder,
      },
    });
  }

  async deleteSection(id: string, ownerId: string) {
    const section = await this.prisma.menuSection.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!section) throw new NotFoundException('Menu section not found');
    if (section.restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }

    return this.prisma.menuSection.delete({ where: { id } });
  }

  // =============================================
  // FOOD ITEMS
  // =============================================

  async createFoodItem(ownerId: string, dto: CreateFoodItemDto) {
    const section = await this.prisma.menuSection.findUnique({
      where: { id: dto.sectionId },
      include: { restaurant: true },
    });
    if (!section) throw new NotFoundException('Menu section not found');
    if (section.restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }

    return this.prisma.foodItem.create({
      data: {
        sectionId: dto.sectionId,
        name: dto.name,
        nameAr: dto.nameAr,
        price: dto.price,
        description: dto.description,
        descriptionAr: dto.descriptionAr,
        imageUrl: dto.imageUrl,
        originalPrice: dto.originalPrice,
        isOnSale: dto.isOnSale ?? false,
        prepTimeMin: dto.prepTimeMin ?? 10,
        allergens: dto.allergens ?? [],
        addons: dto.addons,
      },
    });
  }

  async updateFoodItem(
    id: string,
    ownerId: string,
    data: Partial<CreateFoodItemDto>,
  ) {
    const item = await this.prisma.foodItem.findUnique({
      where: { id },
      include: { section: { include: { restaurant: true } } },
    });
    if (!item) throw new NotFoundException('Food item not found');
    if (item.section.restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }

    return this.prisma.foodItem.update({
      where: { id },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        price: data.price,
        description: data.description,
        descriptionAr: data.descriptionAr,
        imageUrl: data.imageUrl,
        originalPrice: data.originalPrice,
        isOnSale: data.isOnSale,
        prepTimeMin: data.prepTimeMin,
        allergens: data.allergens,
        addons: data.addons,
      },
    });
  }

  async deleteFoodItem(id: string, ownerId: string) {
    const item = await this.prisma.foodItem.findUnique({
      where: { id },
      include: { section: { include: { restaurant: true } } },
    });
    if (!item) throw new NotFoundException('Food item not found');
    if (item.section.restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }

    return this.prisma.foodItem.delete({ where: { id } });
  }

  async toggleAvailability(id: string, ownerId: string, isAvailable: boolean) {
    const item = await this.prisma.foodItem.findUnique({
      where: { id },
      include: { section: { include: { restaurant: true } } },
    });
    if (!item) throw new NotFoundException('Food item not found');
    if (item.section.restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }

    return this.prisma.foodItem.update({
      where: { id },
      data: { isAvailable },
    });
  }

  async getMenuByRestaurant(restaurantId: string) {
    return this.prisma.menuSection.findMany({
      where: { restaurantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Find food items with filters (public).
   */
  async getFoodItems(filters: {
    restaurantId?: string;
    sectionId?: string;
    search?: string;
    limit?: number;
  }) {
    const { restaurantId, sectionId, search, limit = 50 } = filters;

    const where: any = {
      isAvailable: true,
      section: {
        restaurant: {
          status: 'ACTIVE',
          isActive: true,
        },
      },
    };

    if (restaurantId) where.section = { ...where.section, restaurantId };
    if (sectionId) where.sectionId = sectionId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.foodItem.findMany({
      where,
      include: {
        section: {
          select: {
            id: true,
            name: true,
            restaurantId: true,
          },
        },
      },
      take: Number(limit),
    });
  }

  // =============================================
  // HELPERS
  // =============================================

  private async verifyRestaurantOwnership(
    restaurantId: string,
    ownerId: string,
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (restaurant.ownerId !== ownerId) {
      throw new ForbiddenException('Not your restaurant');
    }
    return restaurant;
  }
}
