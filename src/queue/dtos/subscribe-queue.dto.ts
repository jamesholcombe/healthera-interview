import { IsString, IsNotEmpty } from 'class-validator';

export class SubscribeQueueDto {
  @IsString()
  @IsNotEmpty()
  queueName: string;
}
