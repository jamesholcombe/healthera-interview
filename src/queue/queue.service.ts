import { Inject, Injectable } from '@nestjs/common';
import type { QueueService as QueueServiceInterface } from './interfaces/queue';
import { QueuePublishOptions, QueueSubscribeOptions } from './interfaces/queue';

@Injectable()
export class QueueService {
  constructor(
    @Inject('QUEUE_PROVIDER')
    private readonly queueProvider: QueueServiceInterface,
  ) {}

  async publish(options: QueuePublishOptions): Promise<void> {
    return this.queueProvider.publish(options);
  }

  async subscribe(options: QueueSubscribeOptions): Promise<void> {
    return this.queueProvider.subscribe(options);
  }

  async unsubscribe(queueName: string): Promise<void> {
    return this.queueProvider.unsubscribe(queueName);
  }
}
