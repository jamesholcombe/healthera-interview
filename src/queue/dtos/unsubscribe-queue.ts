import { IsString, IsNotEmpty } from 'class-validator';

export class UnsubscribeQueue {
  @IsString()
  @IsNotEmpty()
  queueName: string;
}
