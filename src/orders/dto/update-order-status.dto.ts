import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.CONFIRMED })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiPropertyOptional({ example: 'Customer not responding' })
  @IsString()
  @IsOptional()
  reason?: string;
}
