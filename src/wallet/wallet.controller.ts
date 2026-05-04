import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { LedgerType, Role } from '@prisma/client';
import { WalletService } from './wallet.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('wallet')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('summary')
  @Roles(Role.DRIVER, Role.VENDOR)
  async getSummary(@CurrentUser('userId') userId: string) {
    return this.walletService.getWalletSummary(userId);
  }

  @Get('ledger')
  @Roles(Role.DRIVER, Role.VENDOR)
  async getLedger(
    @CurrentUser('userId') userId: string,
    @Query('type') type?: LedgerType,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.walletService.getLedger(userId, { type, page, limit });
  }

  @Post('payout')
  @Roles(Role.DRIVER, Role.VENDOR)
  async requestPayout(
    @CurrentUser('userId') userId: string,
    @Body('amount') amount: number,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('mfa-token') mfaToken: string,
    @Headers('app-integrity') appIntegrity: string,
  ) {
    if (!idempotencyKey) throw new UnauthorizedException('Idempotency-Key header is required');
    if (!mfaToken) throw new UnauthorizedException('MFA-Token is required for payouts');
    if (!appIntegrity || appIntegrity !== 'valid-device-token') {
      // In production, verify the token with Play Integrity / DeviceCheck
      throw new UnauthorizedException('App Integrity check failed');
    }

    return this.walletService.requestPayout(userId, amount, idempotencyKey, mfaToken);
  }
}
