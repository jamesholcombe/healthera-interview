import { IsString, IsNotEmpty } from 'class-validator';

export class SubscribeQueue {
  @IsString()
  @IsNotEmpty()
  queueName: string;
}
