import {
  SQSClient,
  GetQueueUrlCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
} from '@aws-sdk/client-sqs';
import * as amqp from 'amqplib';

export class QueueTestHelper {
  private sqsClient: SQSClient | null = null;
  private rabbitmqConnection: amqp.Connection | null = null;
  private rabbitmqChannel: amqp.Channel | null = null;

  setupSQS(config: {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }): void {
    this.sqsClient = new SQSClient({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.accessKeyId
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey || '',
          }
        : undefined,
    });
  }

  async setupRabbitMQ(url: string): Promise<void> {
    const connection = await amqp.connect(url);
    this.rabbitmqConnection = connection as unknown as amqp.Connection;
    this.rabbitmqChannel = await connection.createChannel();
  }

  async cleanupSQSQueue(queueName: string): Promise<void> {
    if (!this.sqsClient) {
      return;
    }

    try {
      const getQueueUrlCommand = new GetQueueUrlCommand({
        QueueName: queueName,
      });
      const response = await this.sqsClient.send(getQueueUrlCommand);

      if (response.QueueUrl) {
        // Try to purge first
        try {
          const purgeCommand = new PurgeQueueCommand({
            QueueUrl: response.QueueUrl,
          });
          await this.sqsClient.send(purgeCommand);
        } catch {
          // Ignore purge errors (queue might not exist or might be in flight)
        }

        // Try to delete
        try {
          const deleteCommand = new DeleteQueueCommand({
            QueueUrl: response.QueueUrl,
          });
          await this.sqsClient.send(deleteCommand);
        } catch {
          // Ignore delete errors
        }
      }
    } catch {
      // Queue might not exist, ignore
    }
  }

  async cleanupRabbitMQQueue(queueName: string): Promise<void> {
    if (!this.rabbitmqChannel) {
      return;
    }

    try {
      await this.rabbitmqChannel.deleteQueue(queueName);
    } catch {
      // Queue might not exist, ignore
    }
  }

  async cleanup(): Promise<void> {
    if (this.rabbitmqChannel) {
      try {
        await this.rabbitmqChannel.close();
      } catch {
        // Ignore
      }
      this.rabbitmqChannel = null;
    }

    if (this.rabbitmqConnection) {
      try {
        const conn = this.rabbitmqConnection as unknown as {
          close: () => Promise<void>;
        };
        await conn.close();
      } catch {
        // Ignore
      }
      this.rabbitmqConnection = null;
    }
  }

  generateQueueName(prefix: string = 'test'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
