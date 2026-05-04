import { IsString, IsOptional, IsNumber } from 'class-validator';

export class UpdateRestaurantDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  descriptionAr?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @IsString()
  @IsOptional()
  vendorType?: string;

  @IsString()
  @IsOptional()
  payoutPhoneNumber?: string;

  @IsOptional()
  workingHours?: any;

  @IsOptional()
  autoAcceptOrders?: boolean;

  @IsOptional()
  notificationsEnabled?: boolean;
}
