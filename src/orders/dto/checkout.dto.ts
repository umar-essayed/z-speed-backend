import {
  IsString,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiProperty({ example: 'restaurant-uuid' })
  @IsString()
  @IsNotEmpty()
  restaurantId: string;

  @ApiProperty({ example: 'address-uuid' })
  @IsString()
  @IsNotEmpty()
  deliveryAddressId: string;

  @ApiProperty({ example: 'CASH', enum: ['CASH', 'WALLET', 'CYBERSOURCE_CARD'] })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiPropertyOptional({ example: 'WELCOME2026' })
  @IsString()
  @IsOptional()
  promoCode?: string;

  @ApiPropertyOptional({ example: 'Please don\'t ring the bell' })
  @IsString()
  @IsOptional()
  customerNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  deviceInformation?: any;

  @ApiPropertyOptional()
  @IsOptional()
  billingInformation?: any;

  @ApiPropertyOptional({ description: 'Required for CYBERSOURCE_CARD payments' })
  @IsString()
  @IsOptional()
  transientToken?: string;
}
