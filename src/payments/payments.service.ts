import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as crypto from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly merchantId: string;
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {
    this.merchantId = this.configService.get<string>('CYBERSOURCE_MERCHANT_ID', '');
    this.apiKeyId = this.configService.get<string>('CYBERSOURCE_API_KEY', '');
    this.apiSecretKey = this.configService.get<string>('CYBERSOURCE_API_SECRET', '');
    this.baseUrl = this.configService.get<string>('CYBERSOURCE_BASE_URL', 'https://apitest.cybersource.com');
  }

  /**
   * Get Flex Capture Context (JWT) for Microform.
   */
  async getFlexCaptureContext() {
    const targetUrl = '/microform/v2/sessions';
    const body = {
      targetOrigins: [this.configService.get<string>('ALLOWED_ORIGINS', 'http://localhost:3000')],
      allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX'],
      clientVersion: 'v2',
    };

    try {
      const response = await this.makeRequest('POST', targetUrl, body);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get capture context', error.response?.data || error.message);
      throw new BadRequestException('Failed to initialize payment session');
    }
  }

  /**
   * Process payment with Flex Transient Token.
   */
  async initiateFlexPayment(orderId: string, transientToken: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });
    if (!order) throw new BadRequestException('Order not found');

    const targetUrl = '/pts/v2/payments';
    const body = {
      clientReferenceInformation: { code: order.id },
      processingInformation: { capture: true },
      paymentInformation: {
        legacyTokenInformation: { id: transientToken },
      },
      orderInformation: {
        amountDetails: {
          totalAmount: order.total.toString(),
          currency: 'EGP',
        },
        billTo: {
          firstName: order.customer.name.split(' ')[0],
          lastName: order.customer.name.split(' ')[1] || 'Customer',
          address1: order.deliveryAddress,
          locality: 'Cairo',
          administrativeArea: 'Cairo',
          postalCode: '11511',
          country: 'EG',
          email: order.customer.email,
          phoneNumber: order.customer.phone || '0000000000',
        },
      },
    };

    try {
      const response = await this.makeRequest('POST', targetUrl, body);
      const decision = response.data.status;

      if (decision === 'AUTHORIZED') {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { paymentState: 'PAID' },
        });
        return { success: true, transactionId: response.data.id };
      }

      return { success: false, status: decision, details: response.data };
    } catch (error) {
      this.logger.error('Payment initiation failed', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  /**
   * Verify Webhook Signature.
   */
  verifyWebhookSignature(payload: any, signature: string): boolean {
    const secret = this.configService.get<string>('CYBERSOURCE_SECRET_KEY', '');
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature),
    );
  }

  /**
   * Process Refund/Reversal.
   */
  async processReversal(transactionId: string, amount: number) {
    const targetUrl = `/pts/v2/payments/${transactionId}/reversals`;
    const body = {
      reversalInformation: {
        amountDetails: {
          totalAmount: amount.toString(),
          currency: 'EGP',
        },
        reason: 'Order cancelled by customer',
      },
    };

    try {
      const response = await this.makeRequest('POST', targetUrl, body);
      return response.data;
    } catch (error) {
      this.logger.error('Refund failed', error.response?.data || error.message);
      throw new BadRequestException('Failed to process refund');
    }
  }

  // =============================================
  // PRIVATE HELPERS FOR AUTHENTICATION
  // =============================================

  private async makeRequest(method: string, targetUrl: string, body: any = null) {
    const date = new Date().toUTCString();
    const digest = body ? this.calculateDigest(body) : '';
    
    const signatureHeader = this.calculateSignatureHeader(
      method,
      targetUrl,
      date,
      digest,
    );

    const headers = {
      'v-c-merchant-id': this.merchantId,
      'Date': date,
      'Host': new URL(this.baseUrl).host,
      'Signature': signatureHeader,
      'Content-Type': 'application/json',
      ...(digest ? { 'Digest': `SHA-256=${digest}` } : {}),
    };

    return firstValueFrom(
      this.httpService.request({
        method,
        url: `${this.baseUrl}${targetUrl}`,
        headers,
        data: body,
      }),
    );
  }

  private calculateDigest(body: any): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('base64');
  }

  private calculateSignatureHeader(
    method: string,
    targetUrl: string,
    date: string,
    digest: string,
  ): string {
    const host = new URL(this.baseUrl).host;
    const signatureString = 
      `host: ${host}\n` +
      `date: ${date}\n` +
      `(request-target): ${method.toLowerCase()} ${targetUrl}\n` +
      `v-c-merchant-id: ${this.merchantId}` +
      (digest ? `\ndigest: SHA-256=${digest}` : '');

    const signature = crypto
      .createHmac('sha256', Buffer.from(this.apiSecretKey, 'base64'))
      .update(signatureString)
      .digest('base64');

    const headersList = `host date (request-target) v-c-merchant-id${digest ? ' digest' : ''}`;
    
    return `keyid="${this.apiKeyId}", algorithm="HmacSHA256", headers="${headersList}", signature="${signature}"`;
  }
}
