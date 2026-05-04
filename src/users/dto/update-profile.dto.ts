import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  profileImage?: string;

  @IsArray()
  @IsOptional()
  fcmTokens?: string[];

  @IsObject()
  @IsOptional()
  notificationPrefs?: Record<string, any>;
}
