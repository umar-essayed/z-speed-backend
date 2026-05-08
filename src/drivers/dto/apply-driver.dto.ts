import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsOptional()
  make?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsInt()
  @IsOptional()
  year?: number;

  @IsString()
  @IsOptional()
  plateNumber?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  registrationDocUrl?: string;

  @IsString()
  @IsOptional()
  insuranceDocUrl?: string;

  @IsString()
  @IsOptional()
  vehiclePhotoUrl?: string;
}

export class ApplyDriverDto {
  @IsString()
  @IsNotEmpty()
  nationalId: string;

  @IsString()
  @IsNotEmpty()
  nationalIdUrl: string;

  @IsString()
  @IsNotEmpty()
  driverLicenseUrl: string;

  @IsString()
  @IsOptional()
  policeClearanceUrl?: string;

  @IsString()
  @IsOptional()
  facePhotoUrl?: string;

  @IsString()
  @IsOptional()
  payoutPhoneNumber?: string;

  @IsOptional()
  vehicle?: CreateVehicleDto;
}

