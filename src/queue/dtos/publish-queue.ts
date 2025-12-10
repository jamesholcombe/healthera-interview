import {
  IsString,
  IsNotEmpty,
  ValidateNested,
  IsDefined,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QueueMessage } from './queue-message';

export class PublishQueue {
  @IsString()
  @IsNotEmpty()
  queueName: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => QueueMessage)
  message: QueueMessage;
}
