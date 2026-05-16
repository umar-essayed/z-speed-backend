import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @CurrentUser('userId') userId: string,
    @Query('read') read?: boolean,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.notificationsService.getNotifications(userId, { read, page, limit });
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser('userId') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markRead(userId, id);
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser('userId') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  @Delete(':id')
  async deleteNotification(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.deleteNotification(userId, id);
  }

  @Post('test')
  async testNotification(@CurrentUser('userId') userId: string) {
    return this.notificationsService.createNotification(
      userId,
      'Test Notification',
      'This is a test notification from the system.',
      'test',
      { time: new Date().toISOString() },
    );
  }

  @Post('test-vendor')
  async testVendorNotification(
    @CurrentUser('userId') userId: string,
    @Body('restaurantId') restaurantId: string,
  ) {
    return this.notificationsService.notifyVendor(restaurantId, 'test-order-id');
  }

  @Post('token')
  async updateFcmToken(
    @CurrentUser('userId') userId: string,
    @Body('token') token: string,
  ) {
    return this.notificationsService.updateFcmToken(userId, token);
  }
}

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('push')
  async sendPush(
    @Body('userIds') userIds: string[],
    @Body('title') title: string,
    @Body('body') body: string,
    @Body('data') data?: any,
  ) {
    return this.notificationsService.sendPush(userIds, title, body, data);
  }
}
