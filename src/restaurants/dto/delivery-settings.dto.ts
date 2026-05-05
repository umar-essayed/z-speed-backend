import { IsNumber, IsOptional, IsString } from 'class-validator';

export class DeliverySettingsDto {
  @IsNumber()
  @IsOptional()
  deliveryRadiusKm?: number;

  @IsNumber()
  @IsOptional()
  deliveryTimeMin?: number;

  @IsNumber()
  @IsOptional()
  deliveryTimeMax?: number;

  @IsString()
  @IsOptional()
  deliveryFeeMode?: string;

  @IsNumber()
  @IsOptional()
  deliveryFee?: number;

  @IsNumber()
  @IsOptional()
  minimumOrder?: number;

  @IsOptional()
  deliveryFeeTiers?: any;

  @IsOptional()
  deliveryFeeFormula?: any;

  @IsString()
  @IsOptional()
  serviceFeeType?: string;

  @IsNumber()
  @IsOptional()
  serviceFeeValue?: number;
}
