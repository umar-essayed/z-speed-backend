import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('loyalty')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('my-points')
  getPoints(@CurrentUser() user: any) {
    return this.loyaltyService.getPoints(user.userId);
  }

  @Post('redeem')
  redeem(@CurrentUser() user: any, @Body('points') points: number) {
    return this.loyaltyService.redeemPoints(user.userId, points);
  }
}
