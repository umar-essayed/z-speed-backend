import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import { CalculateOrderDto, CheckoutDto, UpdateOrderStatusDto } from './dto';

// ============================================================
// CUSTOMER ROUTES — /orders
// ============================================================
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN, Role.SUPERADMIN)
  async getOrders(
    @CurrentUser('userId') currentUserId: string,
    @CurrentUser('role') role: Role,
    @Query('customerId') customerId?: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    // Admins can query any customer; customers can only see their own orders
    const isAdmin = ([Role.ADMIN, Role.SUPERADMIN] as Role[]).includes(role);
    const targetId = isAdmin && customerId ? customerId : currentUserId;
    return this.ordersService.getMyOrders(targetId, { status, page, limit });
  }

  @Post('checkout')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async checkout(
    @CurrentUser('userId') userId: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.ordersService.checkout(userId, dto);
  }

  @Post('validate-promo')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async validatePromo(
    @CurrentUser('userId') userId: string,
    @Body('code') code: string,
    @Body('subtotal') subtotal: number,
  ) {
    return this.ordersService.validatePromo(code, subtotal, userId);
  }

  @Post('calculate')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async calculate(
    @CurrentUser('userId') userId: string,
    @Body() dto: CalculateOrderDto,
  ) {
    return this.ordersService.calculate(userId, dto);
  }

  @Get('my')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async getMyOrders(
    @CurrentUser('userId') userId: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.getMyOrders(userId, { status, page, limit });
  }

  @Get(':id')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  async getOrderById(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getOrderById(id, userId, role);
  }

  @Get(':id/tracking')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async getTracking(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getTrackingInfo(id, userId);
  }

  @Patch(':id/cancel')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async cancelOrder(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.ordersService.cancelOrder(id, userId, reason);
  }

  @Post(':id/dispute')
  @UseGuards(SuperTokensAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async createDispute(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string; details?: string },
  ) {
    return this.ordersService.createDispute(id, userId, body);
  }
}

// ============================================================
// VENDOR ROUTES — /vendor/orders
// ============================================================
@Controller('vendor/orders')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
export class VendorOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getVendorOrders(
    @CurrentUser('userId') userId: string,
    @Query('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.getVendorOrders(restaurantId, userId, {
      status,
      page,
      limit,
    });
  }

  @Patch(':id/status')
  @Roles(Role.VENDOR, Role.DRIVER, Role.ADMIN, Role.SUPERADMIN)
  async updateOrderStatus(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto, userId, role);
  }

  @Post(':id/dispatch')
  @Roles(Role.VENDOR, Role.ADMIN)
  async manualDispatch(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (role === Role.VENDOR && order.restaurant.ownerId !== userId) {
      throw new ForbiddenException('Not your restaurant order');
    }
    await this.ordersService.assignDriversToOrder(id);
    return { success: true, message: 'Dispatch process initiated' };
  }

  @Get(':id/eligible-drivers')
  @Roles(Role.VENDOR, Role.ADMIN)
  async getEligibleDrivers(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (role === Role.VENDOR && order.restaurant.ownerId !== userId) {
      throw new ForbiddenException('Not your restaurant order');
    }
    return this.ordersService.getEligibleDrivers(id);
  }

  @Post(':id/request-driver')
  @Roles(Role.VENDOR, Role.ADMIN)
  async requestSpecificDriver(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('driverId', ParseUUIDPipe) driverId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (role === Role.VENDOR && order.restaurant.ownerId !== userId) {
      throw new ForbiddenException('Not your restaurant order');
    }
    return this.ordersService.requestDriver(id, driverId);
  }
}
