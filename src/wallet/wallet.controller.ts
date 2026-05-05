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
import { PayoutRequestDto } from './dto/payout-request.dto';

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
    @Body() payoutDto: PayoutRequestDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('mfa-token') mfaToken: string,
    @Headers('app-integrity') appIntegrity: string,
  ) {
    if (!idempotencyKey) throw new UnauthorizedException('Idempotency-Key header is required');
    
    // In development, we relax these checks to allow any value, but they must be present
    if (!mfaToken) {
      throw new UnauthorizedException('MFA-Token header is required for payouts');
    }
    
    if (!appIntegrity) {
      throw new UnauthorizedException('App-Integrity header is required');
    }

    return this.walletService.requestPayout(userId, payoutDto, idempotencyKey, mfaToken);
  }
}
