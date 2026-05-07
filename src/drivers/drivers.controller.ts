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
import { DriversService } from './drivers.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import { ApplyDriverDto, UpdateLocationDto } from './dto';

@Controller('drivers')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get('available')
  @Roles(Role.DRIVER, Role.VENDOR, Role.ADMIN)
  async getAvailableDrivers() {
    return this.driversService.getAvailableDrivers();
  }

  @Post('apply')
  @Roles(Role.DRIVER)
  async apply(
    @CurrentUser('userId') userId: string,
    @Body() dto: ApplyDriverDto,
  ) {
    return this.driversService.applyDriver(userId, dto);
  }

  @Patch('availability')
  @Roles(Role.DRIVER)
  async toggleAvailability(
    @CurrentUser('userId') userId: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    return this.driversService.toggleAvailability(userId, isAvailable);
  }

  @Patch('location')
  @Roles(Role.DRIVER)
  async updateLocation(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.driversService.updateLocation(userId, dto);
  }

  @Get('delivery-requests')
  @Roles(Role.DRIVER)
  async getDeliveryRequests(@CurrentUser('userId') userId: string) {
    return this.driversService.getDeliveryRequests(userId);
  }

  @Patch('delivery-requests/:id/accept')
  @Roles(Role.DRIVER)
  async acceptRequest(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.driversService.acceptRequest(userId, id);
  }

  @Patch('delivery-requests/:id/reject')
  @Roles(Role.DRIVER)
  async rejectRequest(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.driversService.rejectRequest(userId, id, reason);
  }

  @Get('my-orders')
  @Roles(Role.DRIVER)
  async getMyOrders(
    @CurrentUser('userId') userId: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.driversService.getMyOrders(userId, { status, page, limit });
  }

  @Get('earnings')
  @Roles(Role.DRIVER)
  async getEarnings(@CurrentUser('userId') userId: string) {
    return this.driversService.getEarnings(userId);
  }
}
