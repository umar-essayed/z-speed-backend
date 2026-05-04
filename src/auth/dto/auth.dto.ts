import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class EmailRegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'محمد أحمد' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: Role, default: Role.CUSTOMER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class EmailLoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  password: string;
}

export class SocialAuthDto {
  @ApiProperty({ description: 'The token received from Google or Apple (ID Token or Access Token depending on flow)' })
  @IsString()
  token: string;

  @ApiPropertyOptional({ description: 'User role to assign if creating a new account', enum: Role, default: Role.CUSTOMER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ description: 'Optional name from the social provider' })
  @IsOptional()
  @IsString()
  name?: string;
}


export class PhoneSendOtpDto {
  @ApiProperty({ example: '+201012345678' })
  @IsString()
  phone: string;
}

export class PhoneVerifyOtpDto {
  @ApiProperty({ example: '+201012345678' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  code: string;
}

export class DebugLoginDto {
  @ApiPropertyOptional({ example: 'debug@zspeed.app' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
