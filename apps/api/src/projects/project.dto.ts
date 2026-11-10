import { IsString, Length } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(1, 80)
  name: string;
}

export class StartRunDto {
  @IsString()
  @Length(1, 4000)
  prompt: string;
}
