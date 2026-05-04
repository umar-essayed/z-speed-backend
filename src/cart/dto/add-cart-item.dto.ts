import { IsString, IsNotEmpty, IsInt, IsOptional, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  @IsOptional()
  foodItemId?: string;

  @IsString()
  @IsOptional()
  menuItemId?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  selectedAddons?: any;

  @IsString()
  @IsOptional()
  specialNote?: string;

  // Extra fields sent by frontend to avoid "property should not exist" errors
  @IsOptional()
  id?: string;

  @IsOptional()
  sectionId?: string;

  @IsOptional()
  restaurantId?: string;

  @IsOptional()
  menuItemName?: string;

  @IsOptional()
  imageUrl?: string;

  @IsOptional()
  unitPrice?: number;

  @IsOptional()
  measureType?: string;

  @IsOptional()
  addonsTotal?: number;

  @IsOptional()
  itemTotal?: number;

  @IsOptional()
  addedAt?: string;
}

