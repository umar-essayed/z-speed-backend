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

    const finalItem = await this.prisma.foodItem.findUnique({
      where: { id: createdItem.id },
      include: { variants: true },
    });

    // Explicitly trigger a direct sync to Firestore so that all committed variants are updated
    await this.prisma.syncFoodItemDirect(createdItem.id).catch(() => {});

    return finalItem;
  }

  async createFoodItemsBulk(ownerId: string, dtos: CreateFoodItemDto[]) {
    // 1. Group sections and verify ownership
    const sectionIds = Array.from(new Set(dtos.map(d => d.sectionId)));
    
    for (const sectionId of sectionIds) {
      const section = await this.prisma.raw.menuSection.findUnique({
        where: { id: sectionId },
        include: { restaurant: true },
      });
      if (!section) throw new NotFoundException(`Menu section ${sectionId} not found`);
      if (section.restaurant.ownerId !== ownerId) {
        throw new ForbiddenException('Not your restaurant');
      }
    }

    const results: any[] = [];
    
    // 2. Insert items and their variants in a transaction using the raw client
    await this.prisma.raw.$transaction(async (tx) => {
      for (const dto of dtos) {
        const { variants, ...itemData } = dto;
        const createdItem = await tx.foodItem.create({
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

          await tx.foodItemVariant.createMany({
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
          await tx.foodItemVariant.createMany({
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

        results.push(createdItem);
      }
    });

    // 3. Sync all items to Firestore in bulk (asynchronously in the background)
    setImmediate(async () => {
      try {
        const admin = require('firebase-admin');
        if (admin.apps.length) {
          const db = admin.firestore();
          if (db) {
            // Group menuSection queries to avoid redundant DB reads
            const sectionMap = new Map();
            for (const sectionId of sectionIds) {
              const section = await this.prisma.raw.menuSection.findUnique({
                where: { id: sectionId },
                select: { 
                  restaurantId: true, 
                  firebaseId: true,
                  restaurant: { select: { firebaseId: true } }
                }
              }).catch(() => null);
              if (section) {
                sectionMap.set(sectionId, section);
              }
            }

            const batchSize = 500;
            for (let i = 0; i < results.length; i += batchSize) {
              const chunk = results.slice(i, i + batchSize);
              const firestoreBatch = db.batch();
              
              for (const item of chunk) {
                const section = sectionMap.get(item.sectionId);
                const restaurantId = section?.restaurantId;
                if (!restaurantId) continue;

                const firestoreRestaurantId = section?.restaurant?.firebaseId || restaurantId;
                const firestoreSectionId = section?.firebaseId || item.sectionId;

                const variants = await this.prisma.raw.foodItemVariant.findMany({
                  where: { foodItemId: item.id }
                }).catch(() => []);

                const syncData: any = {
                  id: item.id,
                  sectionId: firestoreSectionId,
                  restaurantId: firestoreRestaurantId,
                  name: item.name,
                  nameAr: item.nameAr || null,
                  description: item.description || null,
                  descriptionAr: item.descriptionAr || null,
                  imageUrl: item.imageUrl || null,
                  price: item.price,
                  originalPrice: item.originalPrice || null,
                  isOnSale: item.isOnSale,
                  isAvailable: item.isAvailable,
                  stockQuantity: item.stockQuantity,
                  hasFractions: item.hasFractions,
                  fractionUnitName: item.fractionUnitName || null,
                  fractionUnitNameAr: item.fractionUnitNameAr || null,
                  unitsPerParent: item.unitsPerParent || null,
                  fractionPrice: item.fractionPrice || null,
                  addons: item.addons || null,
                  allergens: item.allergens || [],
                  prepTimeMin: item.prepTimeMin ?? 10,
                  unit: item.unit || null,
                  tags: item.tags || [],
                  updatedAt: new Date(),
                  variants: variants.map(v => ({
                    id: v.firebaseId || v.id,
                    foodItemId: v.foodItemId,
                    name: v.name,
                    nameAr: v.nameAr || null,
                    price: v.price,
                    originalPrice: v.originalPrice || null,
                    stockQuantity: v.stockQuantity,
                    isAvailable: v.isAvailable,
                    isFraction: v.isFraction,
                    fractionMultiplier: v.fractionMultiplier || null,
                    updatedAt: v.updatedAt
                  }))
                };

                const docRef = db.collection('restaurants').doc(firestoreRestaurantId)
                  .collection('menuSections').doc(firestoreSectionId)
                  .collection('items').doc(item.id);
                
                firestoreBatch.set(docRef, syncData, { merge: true });
              }
              
              await firestoreBatch.commit().catch((err: any) => {
                this.logger.error(`Failed to commit bulk firestore sync: ${err.message}`);
              });
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Background bulk Firestore sync failed: ${err.message}`);
      }
    });

    return { count: results.length };
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

    const finalItem = await this.prisma.foodItem.findUnique({
      where: { id },
      include: { variants: true },
    });

    // Explicitly trigger a direct sync to Firestore so that all committed variants are updated
    await this.prisma.syncFoodItemDirect(id).catch(() => {});

    return finalItem;
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
