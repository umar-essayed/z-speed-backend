import {
  IsString,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalculateOrderDto {
  @ApiProperty({ example: 'restaurant-uuid' })
  @IsString()
  @IsNotEmpty()
  restaurantId: string;

  @ApiProperty({ example: 'address-uuid' })
  @IsString()
  @IsNotEmpty()
  deliveryAddressId: string;

  @ApiPropertyOptional({ example: 'WELCOME2026' })
  @IsString()
  @IsOptional()
  promoCode?: string;
}
