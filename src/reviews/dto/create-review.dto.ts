import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  orderId: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  restaurantRating: number;

  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  driverRating?: number;

  @IsString()
  @IsOptional()
  comment?: string;
}
