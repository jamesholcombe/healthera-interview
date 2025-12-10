import { IsString, IsNotEmpty } from 'class-validator';

export class UnsubscribeQueueDto {
  @IsString()
  @IsNotEmpty()
  queueName: string;
}
