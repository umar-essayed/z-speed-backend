import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a review for a delivered order.
   */
  async create(customerId: string, dto: CreateReviewDto) {
    // Verify order belongs to customer and is delivered
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { driver: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('You can only review your own orders');
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Can only review delivered orders');
    }

    // Check for existing review
    const existing = await this.prisma.review.findFirst({
      where: { orderId: dto.orderId, customerId },
    });
    if (existing) {
      throw new BadRequestException('You have already reviewed this order');
    }

    // Create the review
    const review = await this.prisma.review.create({
      data: {
        orderId: dto.orderId,
        customerId,
        restaurantId: order.restaurantId,
        restaurantRating: dto.restaurantRating,
        driverRating: dto.driverRating,
        comment: dto.comment,
      },
    });

    // Recalculate restaurant rating
    const restaurantStats = await this.prisma.review.aggregate({
      where: { restaurantId: order.restaurantId },
      _avg: { restaurantRating: true },
      _count: { restaurantRating: true },
    });

    await this.prisma.restaurant.update({
      where: { id: order.restaurantId },
      data: {
        rating: Math.round((restaurantStats._avg.restaurantRating ?? 0) * 10) / 10,
        ratingCount: restaurantStats._count.restaurantRating,
      },
    });

    // Recalculate driver rating if applicable
    if (dto.driverRating && order.driverId) {
      const driverStats = await this.prisma.review.aggregate({
        where: {
          order: { driverId: order.driverId },
          driverRating: { not: null },
        },
        _avg: { driverRating: true },
        _count: { driverRating: true },
      });

      await this.prisma.driverProfile.update({
        where: { id: order.driverId },
        data: {
          rating: Math.round((driverStats._avg.driverRating ?? 0) * 10) / 10,
          ratingCount: driverStats._count.driverRating,
        },
      });
    }

    this.logger.log(`Review created for order ${dto.orderId}`);
    return review;
  }

  /**
   * Get reviews for a restaurant.
   */
  async getByRestaurant(restaurantId: string, page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { restaurantId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true, profileImage: true } },
        },
      }),
      this.prisma.review.count({ where: { restaurantId } }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Vendor replies to a review.
   */
  async replyToReview(reviewId: string, vendorId: string, reply: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { restaurant: { select: { ownerId: true } } },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.restaurant.ownerId !== vendorId) {
      throw new ForbiddenException('You can only reply to reviews for your restaurant');
    }

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { vendorReply: reply },
    });
  }

  /**
   * Check if user has reviewed an order.
   */
  async hasReviewed(customerId: string, orderId: string) {
    const review = await this.prisma.review.findFirst({
      where: { orderId, customerId },
    });
    return { hasReviewed: !!review };
  }
}
