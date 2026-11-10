import { IsString, Length, Matches } from 'class-validator';

export class CredentialsDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-z0-9_-]+$/, {
    message:
      'username may only contain lowercase letters, digits, "_" and "-"',
  })
  username: string;

  @IsString()
  @Length(8, 128)
  password: string;
}
