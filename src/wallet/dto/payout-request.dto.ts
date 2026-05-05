import { IsNumber, IsString, IsNotEmpty, Min, IsOptional } from 'class-validator';

export class PayoutRequestDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  payoutMethod: string; // 'INSTAPAY' | 'VODAFONE_CASH' | 'BANK_ACCOUNT'

  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  confirmAccountNumber: string;

  @IsString()
  @IsOptional()
  methodDetails?: string; // e.g. Bank Name
}
