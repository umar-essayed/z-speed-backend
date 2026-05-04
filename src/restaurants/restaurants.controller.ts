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
import { RestaurantsService } from './restaurants.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { OptionalSuperTokensAuthGuard } from '../common/guards/optional-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import {
  CreateRestaurantDto,
  UpdateRestaurantDto,
  DeliverySettingsDto,
  FilterRestaurantsDto,
} from './dto';

// ============================================================
// PUBLIC ROUTES — /restaurants
// ============================================================
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get()
  @UseGuards(OptionalSuperTokensAuthGuard)
  async findAll(
    @CurrentUser('userId') userId: string,
    @Query() filters: FilterRestaurantsDto,
  ) {
    return this.restaurantsService.findAll({
      userId,
      ...filters,
    });
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.restaurantsService.findById(id);
  }

  @Get('search/global')
  async globalSearch(
    @Query('q') query: string,
    @Query('city') city?: string,
  ) {
    return this.restaurantsService.globalSearch(query, city);
  }

  @Get(':id/menu')
  async getMenu(@Param('id', ParseUUIDPipe) id: string) {
    const restaurant = await this.restaurantsService.findById(id);
    return restaurant?.menuSections || [];
  }
}

// ============================================================
// VENDOR ROUTES — /vendor/restaurants
// ============================================================
@Controller('vendor/restaurants')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
export class VendorRestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get('my')
  async getMyRestaurants(@CurrentUser('userId') userId: string) {
    return this.restaurantsService.findByOwner(userId);
  }

  @Post()
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateRestaurantDto,
  ) {
    return this.restaurantsService.create(userId, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRestaurantDto,
  ) {
    return this.restaurantsService.update(id, userId, dto);
  }

  @Patch(':id/delivery-settings')
  async updateDeliverySettings(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliverySettingsDto,
  ) {
    return this.restaurantsService.updateDeliverySettings(id, userId, dto);
  }

  @Patch(':id/toggle-open')
  async toggleOpen(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isOpen') isOpen: boolean,
  ) {
    return this.restaurantsService.toggleOpen(id, userId, isOpen);
  }

  @Get(':id/menu')
  async getMenu(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.restaurantsService.getVendorMenu(id, userId);
  }

  @Get(':id/stats')
  async getStats(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.restaurantsService.getStats(id);
  }

  @Get(':id/analytics')
  async getAnalytics(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('range') range?: string,
  ) {
    return this.restaurantsService.getAnalytics(id, userId, range);
  }
}
