import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  CreateQueueCommand,
  MessageAttributeValue,
  GetQueueUrlCommandOutput,
  CreateQueueCommandOutput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import {
  QueueService,
  QueuePublishOptions,
  QueueSubscribeOptions,
  QueueMessage,
} from '../interfaces/queue';
import {
  QueueNotFoundError,
  QueueCreationError,
  QueuePublishError,
  QueueSubscribeError,
} from '../errors/queue.errors';

@Injectable()
export class SqsProvider implements QueueService, OnModuleDestroy {
  private readonly logger = new Logger(SqsProvider.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrls: Map<string, string> = new Map();
  private readonly pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly subscribedQueues: Set<string> = new Set();
  private readonly region: string;
  private readonly endpoint?: string;

  constructor(
    @Inject('SQS_CONFIG')
    private readonly config: {
      region: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    },
  ) {
    this.region = config.region;
    this.endpoint = config.endpoint;

    this.sqsClient = new SQSClient({
      region: this.region,
      endpoint: this.endpoint,
      credentials: config.accessKeyId
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey || '',
          }
        : undefined,
    });
  }

  onModuleDestroy() {
    // Clean up all polling intervals
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
    this.subscribedQueues.clear();
  }

  private isQueueNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    // Check for AWS SDK v3 error structure
    const errorObj = error as Record<string, unknown>;
    return (
      errorObj.Code === 'AWS.SimpleQueueService.NonExistentQueue' ||
      errorObj.name === 'QueueDoesNotExist' ||
      (typeof errorObj.Error === 'object' &&
        errorObj.Error !== null &&
        (errorObj.Error as Record<string, unknown>).Code ===
          'AWS.SimpleQueueService.NonExistentQueue')
    );
  }

  private async ensureQueueExists(queueName: string): Promise<string> {
    // Check cache first
    if (this.queueUrls.has(queueName)) {
      return this.queueUrls.get(queueName)!;
    }

    // Try to get existing queue URL
    try {
      const command = new GetQueueUrlCommand({ QueueName: queueName });
      const response: GetQueueUrlCommandOutput =
        await this.sqsClient.send(command);
      if (response.QueueUrl) {
        this.queueUrls.set(queueName, response.QueueUrl);
        return response.QueueUrl;
      }
    } catch (error: unknown) {
      // If queue doesn't exist, create it
      if (this.isQueueNotFoundError(error)) {
        this.logger.log(`Queue "${queueName}" not found, creating it...`);
        return this.createQueue(queueName);
      }
      // Re-throw other errors
      throw error;
    }

    throw new QueueNotFoundError(queueName);
  }

  private async createQueue(queueName: string): Promise<string> {
    if (!queueName || typeof queueName !== 'string') {
      throw new QueueCreationError(
        queueName || 'undefined',
        new Error('Queue name is required and must be a string'),
      );
    }

    try {
      const createCommand = new CreateQueueCommand({
        QueueName: queueName,
      });
      const createResponse: CreateQueueCommandOutput =
        await this.sqsClient.send(createCommand);
      if (
        createResponse.QueueUrl &&
        typeof createResponse.QueueUrl === 'string'
      ) {
        this.queueUrls.set(queueName, createResponse.QueueUrl);
        this.logger.log(`Queue "${queueName}" created successfully`);
        return createResponse.QueueUrl;
      }
      throw new QueueCreationError(queueName);
    } catch (error: unknown) {
      if (error instanceof QueueCreationError) {
        throw error;
      }
      throw new QueueCreationError(
        queueName,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private async getQueueUrl(queueName: string): Promise<string> {
    return this.ensureQueueExists(queueName);
  }

  async publish(options: QueuePublishOptions): Promise<void> {
    try {
      const queueUrl = await this.getQueueUrl(options.queueName);
      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: options.message.body,
        MessageAttributes: options.message.attributes
          ? Object.entries(options.message.attributes).reduce(
              (acc, [key, value]) => {
                acc[key] = {
                  DataType: 'String',
                  StringValue: value,
                };
                return acc;
              },
              {} as Record<string, MessageAttributeValue>,
            )
          : undefined,
      });

      await this.sqsClient.send(command);
      this.logger.log(`Message published to queue: ${options.queueName}`);
    } catch (error: unknown) {
      // If it's already one of our custom errors, re-throw it
      if (
        error instanceof QueueNotFoundError ||
        error instanceof QueueCreationError ||
        error instanceof QueuePublishError
      ) {
        throw error;
      }
      // Transform AWS errors into our custom error types
      if (this.isQueueNotFoundError(error)) {
        throw new QueueNotFoundError(options.queueName);
      }
      // Wrap other errors
      throw new QueuePublishError(
        options.queueName,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async subscribe(options: QueueSubscribeOptions): Promise<void> {
    try {
      const queueUrl = await this.getQueueUrl(options.queueName);

      // Stop existing subscription if any
      if (this.pollingIntervals.has(options.queueName)) {
        this.subscribedQueues.delete(options.queueName);
        const existingInterval = this.pollingIntervals.get(options.queueName);
        if (existingInterval) {
          clearInterval(existingInterval);
          this.pollingIntervals.delete(options.queueName);
        }
      }

      const pollMessages = async () => {
        // Check if still subscribed before processing
        if (!this.subscribedQueues.has(options.queueName)) {
          return;
        }

        try {
          const command = new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1, // Short polling for faster tests
            AttributeNames: ['All'],
            MessageAttributeNames: ['All'],
          });

          const response: ReceiveMessageCommandOutput =
            await this.sqsClient.send(command);

          // Check again after long poll completes
          if (!this.subscribedQueues.has(options.queueName)) {
            return;
          }

          if (response.Messages && response.Messages.length > 0) {
            for (const message of response.Messages) {
              try {
                const attributes: Record<string, string> = {};
                if (message.MessageAttributes) {
                  for (const [key, attr] of Object.entries(
                    message.MessageAttributes,
                  )) {
                    if (
                      attr &&
                      typeof attr === 'object' &&
                      'StringValue' in attr &&
                      typeof attr.StringValue === 'string'
                    ) {
                      attributes[key] = attr.StringValue;
                    }
                  }
                }

                const queueMessage: QueueMessage = {
                  id: message.MessageId,
                  body: message.Body ?? '',
                  attributes:
                    Object.keys(attributes).length > 0 ? attributes : undefined,
                };

                // Check again before processing message (in case unsubscribed during processing)
                if (!this.subscribedQueues.has(options.queueName)) {
                  return;
                }

                await options.handler(queueMessage);

                // Delete message after successful processing
                if (
                  message.ReceiptHandle &&
                  typeof message.ReceiptHandle === 'string'
                ) {
                  const deleteCommand = new DeleteMessageCommand({
                    QueueUrl: queueUrl,
                    ReceiptHandle: message.ReceiptHandle,
                  });
                  await this.sqsClient.send(deleteCommand);
                }
              } catch (handlerError: unknown) {
                this.logger.error(
                  `Error processing message from queue ${options.queueName}:`,
                  handlerError,
                );
                // Message will remain in queue for retry
              }
            }
          }
        } catch (error: unknown) {
          this.logger.error(
            `Error receiving messages from queue ${options.queueName}:`,
            error,
          );
        }
      };

      // Mark queue as subscribed
      this.subscribedQueues.add(options.queueName);

      void pollMessages();

      const interval = setInterval(() => {
        void pollMessages();
      }, 1000);
      this.pollingIntervals.set(options.queueName, interval);

      this.logger.log(`Subscribed to queue: ${options.queueName}`);
    } catch (error: unknown) {
      // If it's already one of our custom errors, re-throw it
      if (
        error instanceof QueueNotFoundError ||
        error instanceof QueueCreationError ||
        error instanceof QueueSubscribeError
      ) {
        throw error;
      }
      // Transform AWS errors into our custom error types
      if (this.isQueueNotFoundError(error)) {
        throw new QueueNotFoundError(options.queueName);
      }
      // Wrap other errors
      throw new QueueSubscribeError(
        options.queueName,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async unsubscribe(queueName: string): Promise<void> {
    // Remove from subscribed set first to stop processing new messages
    this.subscribedQueues.delete(queueName);

    const interval = this.pollingIntervals.get(queueName);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(queueName);
      this.logger.log(`Unsubscribed from queue: ${queueName}`);
    }
    return Promise.resolve();
  }
}
