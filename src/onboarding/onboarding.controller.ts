import { Controller, Post, Body, UseGuards, Request, Param } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('driver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async submitDriver(@Request() req: any, @Body() data: any) {
    return this.onboardingService.submitDriverApplication(req.user.userId, data);
  }

  @Post('restaurant')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  async submitRestaurant(@Request() req: any, @Body() data: any) {
    return this.onboardingService.submitRestaurantApplication(req.user.userId, data);
  }

  @Post('review/:userId/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  async approve(@Request() req: any, @Param('userId') targetUserId: string) {
    return this.onboardingService.approveApplication(targetUserId, req.user.userId);
  }

  @Post('review/:userId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  async reject(@Request() req: any, @Param('userId') targetUserId: string, @Body('reason') reason: string) {
    return this.onboardingService.rejectApplication(targetUserId, req.user.userId, reason);
  }
}
