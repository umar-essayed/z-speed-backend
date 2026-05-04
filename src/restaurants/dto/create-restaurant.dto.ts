import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRestaurantDto {
  @ApiProperty({ example: 'Al-Madina Restaurant' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'مطعم المدينة' })
  @IsString()
  @IsOptional()
  nameAr?: string;

  @ApiProperty({ example: 30.0444 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: 31.2357 })
  @IsNumber()
  longitude: number;

  @ApiProperty({ example: '123 Tahrir St.' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  documentUrls?: string[];

  @ApiPropertyOptional({ example: 'food' })
  @IsString()
  @IsOptional()
  vendorType?: string;

  @ApiPropertyOptional({ example: '+201012345678' })
  @IsString()
  @IsOptional()
  payoutPhoneNumber?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  bankInfo?: {
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    iban?: string;
  };
}
