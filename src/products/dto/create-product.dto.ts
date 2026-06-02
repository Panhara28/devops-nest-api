import {
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsOptional,
  MinLength,
  Min,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  price: number;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  stock: number;

  @IsString()
  @MinLength(2)
  category: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
