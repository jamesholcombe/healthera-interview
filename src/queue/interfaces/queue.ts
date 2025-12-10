export type QueueProvider = 'sqs' | 'rabbitmq';

export interface QueueMessage {
  id?: string;
  body: string;
  attributes?: Record<string, string>;
}

export interface QueuePublishOptions {
  queueName: string;
  message: QueueMessage;
}

export interface QueueSubscribeOptions {
  queueName: string;
  handler: (message: QueueMessage) => Promise<void> | void;
}

export interface QueueService {
  publish(options: QueuePublishOptions): Promise<void>;
  subscribe(options: QueueSubscribeOptions): Promise<void>;
  unsubscribe(queueName: string): Promise<void>;
}
