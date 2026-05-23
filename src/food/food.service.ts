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

    const { variants, ...itemData } = dto;

    const createdItem = await this.prisma.foodItem.create({
      data: {
        sectionId: itemData.sectionId,
        name: itemData.name,
        nameAr: itemData.nameAr,
        price: itemData.price,
        description: itemData.description,
        descriptionAr: itemData.descriptionAr,
        imageUrl: itemData.imageUrl,
        originalPrice: itemData.originalPrice,
        isOnSale: itemData.isOnSale ?? false,
        prepTimeMin: itemData.prepTimeMin ?? 10,
        allergens: itemData.allergens ?? [],
        addons: itemData.addons,
        hasFractions: itemData.hasFractions ?? false,
        fractionUnitName: itemData.fractionUnitName,
        fractionUnitNameAr: itemData.fractionUnitNameAr,
        unitsPerParent: itemData.unitsPerParent,
        fractionPrice: itemData.fractionPrice,
      },
    });

    if (createdItem.hasFractions && createdItem.unitsPerParent) {
      const units = createdItem.unitsPerParent;
      const calculatedStripPrice = createdItem.fractionPrice || Number((createdItem.price / units).toFixed(2));
      
      const boxName = 'Box';
      const boxNameAr = 'علبة كاملة';
      const stripName = createdItem.fractionUnitName || 'Strip';
      const stripNameAr = createdItem.fractionUnitNameAr || 'شريط';

      await this.prisma.foodItemVariant.createMany({
        data: [
          {
            foodItemId: createdItem.id,
            name: boxName,
            nameAr: boxNameAr,
            price: createdItem.price,
            originalPrice: createdItem.originalPrice,
            stockQuantity: createdItem.stockQuantity,
            isFraction: false,
            fractionMultiplier: units,
          },
          {
            foodItemId: createdItem.id,
            name: stripName,
            nameAr: stripNameAr,
            price: calculatedStripPrice,
            isFraction: true,
            fractionMultiplier: 1,
          }
        ],
      });
    } else if (variants && variants.length > 0) {
      await this.prisma.foodItemVariant.createMany({
        data: variants.map((v: any) => ({
          foodItemId: createdItem.id,
          name: v.name,
          nameAr: v.nameAr,
          price: Number(v.price),
          originalPrice: v.originalPrice ? Number(v.originalPrice) : null,
          stockQuantity: v.stockQuantity ? Number(v.stockQuantity) : 0,
          isAvailable: v.isAvailable ?? true,
          isFraction: v.isFraction ?? false,
          fractionMultiplier: v.fractionMultiplier ? Number(v.fractionMultiplier) : null,
        })),
      });
    }

    return this.prisma.foodItem.findUnique({
      where: { id: createdItem.id },
      include: { variants: true },
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

    const { variants, ...itemData } = data;

    const updatedItem = await this.prisma.foodItem.update({
      where: { id },
      data: {
        name: itemData.name,
        nameAr: itemData.nameAr,
        price: itemData.price,
        description: itemData.description,
        descriptionAr: itemData.descriptionAr,
        imageUrl: itemData.imageUrl,
        originalPrice: itemData.originalPrice,
        isOnSale: itemData.isOnSale,
        prepTimeMin: itemData.prepTimeMin,
        allergens: itemData.allergens,
        addons: itemData.addons,
        hasFractions: itemData.hasFractions,
        fractionUnitName: itemData.fractionUnitName,
        fractionUnitNameAr: itemData.fractionUnitNameAr,
        unitsPerParent: itemData.unitsPerParent,
        fractionPrice: itemData.fractionPrice,
      },
    });

    if (variants) {
      await this.prisma.foodItemVariant.deleteMany({ where: { foodItemId: id } });
      if (variants.length > 0) {
        await this.prisma.foodItemVariant.createMany({
          data: variants.map((v: any) => ({
            foodItemId: id,
            name: v.name,
            nameAr: v.nameAr,
            price: Number(v.price),
            originalPrice: v.originalPrice ? Number(v.originalPrice) : null,
            stockQuantity: v.stockQuantity ? Number(v.stockQuantity) : 0,
            isAvailable: v.isAvailable ?? true,
            isFraction: v.isFraction ?? false,
            fractionMultiplier: v.fractionMultiplier ? Number(v.fractionMultiplier) : null,
          })),
        });
      }
    } else if (itemData.hasFractions !== undefined || itemData.price !== undefined || itemData.unitsPerParent !== undefined) {
      const freshItem = await this.prisma.foodItem.findUnique({ where: { id } });
      if (freshItem?.hasFractions && freshItem.unitsPerParent) {
        await this.prisma.foodItemVariant.deleteMany({ where: { foodItemId: id } });
        const units = freshItem.unitsPerParent;
        const calculatedStripPrice = freshItem.fractionPrice || Number((freshItem.price / units).toFixed(2));
        
        await this.prisma.foodItemVariant.createMany({
          data: [
            {
              foodItemId: id,
              name: 'Box',
              nameAr: 'علبة كاملة',
              price: freshItem.price,
              originalPrice: freshItem.originalPrice,
              stockQuantity: freshItem.stockQuantity,
              isFraction: false,
              fractionMultiplier: units,
            },
            {
              foodItemId: id,
              name: freshItem.fractionUnitName || 'Strip',
              nameAr: freshItem.fractionUnitNameAr || 'شريط',
              price: calculatedStripPrice,
              isFraction: true,
              fractionMultiplier: 1,
            }
          ],
        });
      }
    }

    return this.prisma.foodItem.findUnique({
      where: { id },
      include: { variants: true },
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
          include: { variants: true },
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
        variants: true,
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
