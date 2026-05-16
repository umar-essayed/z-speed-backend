import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';
import { RideType } from '@prisma/client';

export class CreateRideDto {
  @IsString()
  customerId: string;

  @IsString()
  pickupAddress: string;

  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsString()
  dropoffAddress: string;

  @IsNumber()
  dropoffLat: number;

  @IsNumber()
  dropoffLng: number;

  @IsNumber()
  estimatedDistance: number;

  @IsNumber()
  estimatedFare: number;

  @IsEnum(RideType)
  @IsOptional()
  type?: RideType;

  @IsString()
  @IsOptional()
  paymentMethod?: string;
}
