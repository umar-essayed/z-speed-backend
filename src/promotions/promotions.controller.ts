import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CreatePromoDto, UpdatePromoDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  validate(
    @Body('code') code: string,
    @Body('subtotal') subtotal: number,
    @CurrentUser() user: any,
  ) {
    return this.promotionsService.validate(code, subtotal, user.userId);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findAll() {
    return this.promotionsService.findAll();
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findOne(@Param('id') id: string) {
    return this.promotionsService.findOne(id);
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  create(@Body() createPromoDto: CreatePromoDto) {
    return this.promotionsService.create(createPromoDto);
  }

  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  update(@Param('id') id: string, @Body() updatePromoDto: UpdatePromoDto) {
    return this.promotionsService.update(id, updatePromoDto);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  remove(@Param('id') id: string) {
    return this.promotionsService.remove(id);
  }

  // VENDOR ENDPOINTS
  @Get('vendor/:restaurantId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  findByRestaurant(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser('userId') vendorId: string,
  ) {
    return this.promotionsService.findByRestaurant(restaurantId, vendorId);
  }

  @Post('vendor/:restaurantId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  createVendorPromo(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser('userId') vendorId: string,
    @Body() dto: CreatePromoDto,
  ) {
    return this.promotionsService.createForRestaurant(restaurantId, vendorId, dto);
  }

  @Patch('vendor/:restaurantId/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  updateVendorPromo(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser('userId') vendorId: string,
    @Body() dto: UpdatePromoDto,
  ) {
    return this.promotionsService.updateForRestaurant(id, restaurantId, vendorId, dto);
  }

  @Delete('vendor/:restaurantId/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  removeVendorPromo(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser('userId') vendorId: string,
  ) {
    return this.promotionsService.removeForRestaurant(id, restaurantId, vendorId);
  }
}
