import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async toggleFavorite(userId: string, target: { restaurantId?: string; foodItemId?: string }) {
    const { restaurantId, foodItemId } = target;

    const existing = await this.prisma.favorite.findUnique({
      where: {
        userId_restaurantId_foodItemId: {
          userId,
          restaurantId: (restaurantId || null) as any,
          foodItemId: (foodItemId || null) as any,
        },
      },
    });

    if (existing) {
      await this.prisma.favorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    } else {
      await this.prisma.favorite.create({
        data: {
          userId,
          restaurantId,
          foodItemId,
        },
      });
      return { favorited: true };
    }
  }

  async getMyFavorites(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      include: {
        restaurant: true,
        foodItem: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
