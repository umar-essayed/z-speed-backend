import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  details?: string;
}
