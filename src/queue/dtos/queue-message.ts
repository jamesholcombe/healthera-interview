import { IsString, IsOptional, IsObject, IsNotEmpty } from 'class-validator';
import type { QueueMessage as IQueueMessage } from '../interfaces/queue';

export class QueueMessage implements IQueueMessage {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}
