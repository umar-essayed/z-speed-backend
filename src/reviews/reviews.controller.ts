import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReviewsService } from './reviews.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import { CreateReviewDto } from './dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(userId, dto);
  }

  @Get('check')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async checkReview(
    @CurrentUser('userId') userId: string,
    @Query('orderId') orderId: string,
  ) {
    return this.reviewsService.hasReviewed(userId, orderId);
  }

  @Get('restaurant/:id')
  async getByRestaurant(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.reviewsService.getByRestaurant(id, page, limit);
  }

  @Patch(':id/reply')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  async reply(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reply') reply: string,
  ) {
    return this.reviewsService.replyToReview(id, userId, reply);
  }
}
