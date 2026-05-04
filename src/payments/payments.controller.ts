import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('orders/payment')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('flex-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async getFlexToken() {
    return this.paymentsService.getFlexCaptureContext();
  }

  @Post('initiate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async initiatePayment(
    @Body('orderId') orderId: string,
    @Body('transientToken') transientToken: string,
  ) {
    return this.paymentsService.initiateFlexPayment(orderId, transientToken);
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(
    @Headers('v-c-signature') signature: string,
    @Body() payload: any,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing signature');
    }

    const isValid = this.paymentsService.verifyWebhookSignature(payload, signature);
    if (!isValid) {
      throw new BadRequestException('Invalid signature');
    }

    // Logic to handle webhook notifications (like payment success from async sources)
    return { received: true };
  }
}
