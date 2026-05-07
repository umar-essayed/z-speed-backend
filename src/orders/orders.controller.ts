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
import { OrderStatus, Role } from '@prisma/client';
import { OrdersService } from './orders.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import { CheckoutDto, UpdateOrderStatusDto } from './dto';

// ============================================================
// CUSTOMER ROUTES — /orders
// ============================================================
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async getOrders(
    @CurrentUser('userId') currentUserId: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    // If not logged in, return empty list instead of 401
    if (!currentUserId && !customerId) {
      return { data: [], total: 0 };
    }
    
    const targetId = customerId || currentUserId;
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
  constructor(private readonly ordersService: OrdersService) {}

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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found in Postgres');
    
    await this.ordersService.assignDriversToOrder(id);
    return { success: true, message: 'Dispatch process initiated' };
  }
}
