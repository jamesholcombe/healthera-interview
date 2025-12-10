import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import {
  QueueService,
  QueuePublishOptions,
  QueueSubscribeOptions,
  QueueMessage,
} from '../interfaces/queue';

@Injectable()
export class RabbitMqProvider
  implements QueueService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RabbitMqProvider.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  private readonly consumers: Map<string, { consumerTag: string }> = new Map();

  constructor(
    @Inject('RABBITMQ_CONFIG')
    private readonly config: {
      url: string;
    },
  ) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      const conn = await amqp.connect(this.config.url);
      this.connection = conn;

      // ChannelModel has createChannel method
      this.channel = await conn.createChannel();

      // ChannelModel extends EventEmitter, so it has on() method
      conn.on('error', (err: Error) => {
        this.logger.error('RabbitMQ connection error:', err);
      });

      conn.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
      });

      this.logger.log('Connected to RabbitMQ');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    try {
      // Cancel all consumers
      for (const [queueName, consumer] of this.consumers.entries()) {
        try {
          if (this.channel) {
            await this.channel.cancel(consumer.consumerTag);
          }
        } catch (error) {
          this.logger.error(
            `Error canceling consumer for queue ${queueName}:`,
            error,
          );
        }
      }
      this.consumers.clear();

      if (this.channel) {
        await this.channel.close();
      }

      if (this.connection) {
        await this.connection.close();
      }

      this.logger.log('Disconnected from RabbitMQ');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error);
    }
  }

  private async ensureChannel(): Promise<amqp.Channel> {
    if (!this.connection || !this.channel) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error('Failed to create RabbitMQ channel');
    }
    return this.channel;
  }

  async publish(options: QueuePublishOptions): Promise<void> {
    try {
      const channel = await this.ensureChannel();
      await channel.assertQueue(options.queueName, { durable: true });

      const messageBuffer = Buffer.from(options.message.body);
      const messageOptions: amqp.Options.Publish = {
        persistent: true,
        headers: options.message.attributes || {},
      };

      const sent = channel.sendToQueue(
        options.queueName,
        messageBuffer,
        messageOptions,
      );

      if (!sent) {
        throw new Error('Failed to send message to queue');
      }

      this.logger.log(`Message published to queue: ${options.queueName}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish message to queue ${options.queueName}:`,
        error,
      );
      throw error;
    }
  }

  async subscribe(options: QueueSubscribeOptions): Promise<void> {
    try {
      const channel = await this.ensureChannel();
      await channel.assertQueue(options.queueName, { durable: true });

      // Cancel existing consumer if any
      if (this.consumers.has(options.queueName)) {
        await this.unsubscribe(options.queueName);
      }

      const consumeResult = await channel.consume(
        options.queueName,
        (msg) => {
          if (!msg) {
            return;
          }

          // Handle async operations without making the callback async
          void (async () => {
            try {
              const headers = msg.properties.headers;
              const attributes: Record<string, string> = {};

              if (headers && typeof headers === 'object') {
                for (const [key, value] of Object.entries(headers)) {
                  if (typeof value === 'string') {
                    attributes[key] = value;
                  } else if (
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                  ) {
                    attributes[key] = String(value);
                  }
                }
              }

              const messageId =
                typeof msg.properties.messageId === 'string'
                  ? msg.properties.messageId
                  : undefined;

              const queueMessage: QueueMessage = {
                id: messageId,
                body: msg.content.toString(),
                attributes:
                  Object.keys(attributes).length > 0 ? attributes : undefined,
              };

              await options.handler(queueMessage);

              // Acknowledge message after successful processing
              channel.ack(msg);
            } catch (error) {
              this.logger.error(
                `Error processing message from queue ${options.queueName}:`,
                error,
              );
              // Reject message and requeue it
              channel.nack(msg, false, true);
            }
          })();
        },
        { noAck: false },
      );

      this.consumers.set(options.queueName, {
        consumerTag: consumeResult.consumerTag,
      });
      this.logger.log(`Subscribed to queue: ${options.queueName}`);
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to queue ${options.queueName}:`,
        error,
      );
      throw error;
    }
  }

  async unsubscribe(queueName: string): Promise<void> {
    try {
      const consumer = this.consumers.get(queueName);
      if (consumer && this.channel) {
        await this.channel.cancel(consumer.consumerTag);
        this.consumers.delete(queueName);
        this.logger.log(`Unsubscribed from queue: ${queueName}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to unsubscribe from queue ${queueName}:`,
        error,
      );
      throw error;
    }
  }
}
