import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsArray,
} from 'class-validator';

export class CreateFoodItemDto {
  @IsString()
  @IsNotEmpty()
  sectionId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsNumber()
  price: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  descriptionAr?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsNumber()
  @IsOptional()
  originalPrice?: number;

  @IsBoolean()
  @IsOptional()
  isOnSale?: boolean;

  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @IsInt()
  @IsOptional()
  prepTimeMin?: number;

  @IsArray()
  @IsOptional()
  allergens?: string[];

  @IsOptional()
  addons?: any;

  // Fractional Fields
  @IsBoolean()
  @IsOptional()
  hasFractions?: boolean;

  @IsString()
  @IsOptional()
  fractionUnitName?: string;

  @IsString()
  @IsOptional()
  fractionUnitNameAr?: string;

  @IsInt()
  @IsOptional()
  unitsPerParent?: number;

  @IsNumber()
  @IsOptional()
  fractionPrice?: number;

  // Custom Variants
  @IsArray()
  @IsOptional()
  variants?: any[];
}
