import { IsNumber } from 'class-validator';

export class UpdateLocationDto {
  @IsNumber()
  currentLat: number;

  @IsNumber()
  currentLng: number;
}
