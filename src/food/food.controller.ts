import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FoodService } from './food.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import { CreateMenuSectionDto, CreateFoodItemDto } from './dto';
import { Get, Query } from '@nestjs/common';

@Controller('food')
export class PublicFoodController {
  constructor(private readonly foodService: FoodService) {}

  @Get()
  async getFoodItems(
    @Query('restaurantId') restaurantId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: number,
  ) {
    return this.foodService.getFoodItems({
      restaurantId,
      sectionId,
      search,
      limit,
    });
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    // Basic implementation
    return this.foodService.getFoodItems({ limit: 1 }).then(items => items[0]);
  }
}

@Controller('vendor')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
export class FoodController {
  constructor(private readonly foodService: FoodService) {}

  // ============================================================
  // MENU SECTIONS
  // ============================================================

  @Post('menu-sections')
  async createSection(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateMenuSectionDto,
  ) {
    return this.foodService.createSection(userId, dto);
  }

  @Patch('menu-sections/:id')
  async updateSection(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateMenuSectionDto>,
  ) {
    return this.foodService.updateSection(id, userId, body);
  }

  @Delete('menu-sections/:id')
  async deleteSection(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.foodService.deleteSection(id, userId);
  }

  // ============================================================
  // FOOD ITEMS
  // ============================================================

  @Post('food-items')
  async createFoodItem(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateFoodItemDto,
  ) {
    return this.foodService.createFoodItem(userId, dto);
  }

  @Patch('food-items/:id')
  async updateFoodItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateFoodItemDto>,
  ) {
    return this.foodService.updateFoodItem(id, userId, body);
  }

  @Delete('food-items/:id')
  async deleteFoodItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.foodService.deleteFoodItem(id, userId);
  }

  @Patch('food-items/:id/availability')
  async toggleAvailability(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    return this.foodService.toggleAvailability(id, userId, isAvailable);
  }
}
