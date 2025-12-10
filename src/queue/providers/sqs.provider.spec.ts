import { Test, TestingModule } from '@nestjs/testing';
import { SqsProvider } from './sqs.provider';
import {
  SendMessageCommand,
  ReceiveMessageCommand,
  GetQueueUrlCommand,
  CreateQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  QueueCreationError,
  QueuePublishError,
  QueueSubscribeError,
} from '../errors/queue.errors';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sqs', () => {
  const mockSend = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    SendMessageCommand: jest.fn(),
    ReceiveMessageCommand: jest.fn(),
    DeleteMessageCommand: jest.fn(),
    GetQueueUrlCommand: jest.fn(),
    CreateQueueCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

describe('SqsProvider', () => {
  let provider: SqsProvider;
  let mockSend: jest.Mock;

  const mockConfig = {
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    accessKeyId: 'test',
    secretAccessKey: 'test',
  };

  beforeEach(async () => {
    // Get the mocked send function
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqsModule = require('@aws-sdk/client-sqs');
    mockSend = sqsModule.__mockSend;
    mockSend.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsProvider,
        {
          provide: 'SQS_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    provider = module.get<SqsProvider>(SqsProvider);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    provider.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('publish', () => {
    it('should publish a message to an existing queue', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;

      // Mock GetQueueUrlCommand to return existing queue
      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // getQueueUrl
        .mockResolvedValueOnce({}); // sendMessage

      await provider.publish({
        queueName,
        message: {
          body: 'test message',
          attributes: { key: 'value' },
        },
      });

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(GetQueueUrlCommand).toHaveBeenCalledWith({
        QueueName: queueName,
      });
      expect(SendMessageCommand).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        MessageBody: 'test message',
        MessageAttributes: {
          key: {
            DataType: 'String',
            StringValue: 'value',
          },
        },
      });
    });

    it('should create queue if it does not exist', async () => {
      const queueName = 'new-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;

      // Mock GetQueueUrlCommand to throw queue not found error
      const queueNotFoundError = {
        Code: 'AWS.SimpleQueueService.NonExistentQueue',
        name: 'QueueDoesNotExist',
      };

      mockSend
        .mockRejectedValueOnce(queueNotFoundError) // getQueueUrl fails
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // createQueue succeeds
        .mockResolvedValueOnce({}); // sendMessage succeeds

      await provider.publish({
        queueName,
        message: { body: 'test message' },
      });

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(CreateQueueCommand).toHaveBeenCalledWith({
        QueueName: queueName,
      });
    });

    it('should publish message without attributes', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;

      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl })
        .mockResolvedValueOnce({});

      await provider.publish({
        queueName,
        message: { body: 'test message' },
      });

      expect(SendMessageCommand).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        MessageBody: 'test message',
        MessageAttributes: undefined,
      });
    });

    it('should throw QueuePublishError on publish failure', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;
      const error = new Error('Publish failed');

      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl })
        .mockRejectedValueOnce(error);

      await expect(
        provider.publish({
          queueName,
          message: { body: 'test message' },
        }),
      ).rejects.toThrow(QueuePublishError);
    });

    it('should throw QueueNotFoundError when queue does not exist and creation fails', async () => {
      const queueName = 'test-queue';
      const queueNotFoundError = {
        Code: 'AWS.SimpleQueueService.NonExistentQueue',
      };

      mockSend
        .mockRejectedValueOnce(queueNotFoundError) // getQueueUrl fails
        .mockRejectedValueOnce(new Error('Creation failed')); // createQueue fails

      await expect(
        provider.publish({
          queueName,
          message: { body: 'test message' },
        }),
      ).rejects.toThrow(QueueCreationError);
    });
  });

  describe('subscribe', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should subscribe to a queue and start polling', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;
      const handler = jest.fn().mockResolvedValue(undefined);

      // Mock getQueueUrl and then multiple receiveMessage calls (for polling)
      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // getQueueUrl
        .mockResolvedValue({ Messages: [] }); // receiveMessage (empty, no messages)

      await provider.subscribe({
        queueName,
        handler,
      });

      // Fast-forward time to trigger polling
      jest.advanceTimersByTime(2000);

      // Should have attempted to receive messages
      expect(ReceiveMessageCommand).toHaveBeenCalled();
    });

    it('should process received messages', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;
      const handler = jest.fn().mockResolvedValue(undefined);

      const mockMessage = {
        MessageId: 'msg-1',
        Body: 'test message',
        ReceiptHandle: 'receipt-handle',
        MessageAttributes: {
          key: {
            StringValue: 'value',
          },
        },
      };

      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // getQueueUrl
        .mockResolvedValueOnce({
          Messages: [mockMessage],
        }) // receiveMessage (first poll gets message)
        .mockResolvedValue({ Messages: [] }); // subsequent polls return empty

      await provider.subscribe({
        queueName,
        handler,
      });

      // Trigger polling - advance timers and flush promises
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Flush pending promises
      await Promise.resolve(); // Flush more pending promises

      // Wait a bit more for async operations
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith({
        id: 'msg-1',
        body: 'test message',
        attributes: { key: 'value' },
      });
    });

    it('should stop polling when unsubscribed', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;
      const handler = jest.fn().mockResolvedValue(undefined);

      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // getQueueUrl
        .mockResolvedValue({ Messages: [] }); // receiveMessage (empty)

      await provider.subscribe({
        queueName,
        handler,
      });

      await provider.unsubscribe(queueName);

      // Advance timers - should not process messages after unsubscribe
      jest.advanceTimersByTime(2000);
      await Promise.resolve(); // Flush pending promises
      await Promise.resolve(); // Flush more pending promises

      // Handler should not have been called after unsubscribe
      expect(handler).not.toHaveBeenCalled();
    });

    it('should throw QueueSubscribeError on subscription failure', async () => {
      const queueName = 'test-queue';
      const error = new Error('Subscribe failed');

      mockSend.mockRejectedValueOnce(error);

      await expect(
        provider.subscribe({
          queueName,
          handler: jest.fn(),
        }),
      ).rejects.toThrow(QueueSubscribeError);
    });

    it('should handle handler errors gracefully', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));

      const mockMessage = {
        MessageId: 'msg-1',
        Body: 'test message',
        ReceiptHandle: 'receipt-handle',
      };

      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // getQueueUrl
        .mockResolvedValueOnce({ Messages: [mockMessage] }) // receiveMessage (first poll)
        .mockResolvedValue({ Messages: [] }); // subsequent polls return empty

      await provider.subscribe({
        queueName,
        handler,
      });

      // Trigger polling
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Flush pending promises
      await Promise.resolve(); // Flush more pending promises

      // Handler should have been called (error is logged but doesn't throw)
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from a queue', async () => {
      const queueName = 'test-queue';
      const queueUrl = `http://localhost:4566/000000000000/${queueName}`;

      jest.useFakeTimers();

      mockSend
        .mockResolvedValueOnce({ QueueUrl: queueUrl }) // getQueueUrl
        .mockResolvedValue({ Messages: [] }); // receiveMessage (empty)

      await provider.subscribe({
        queueName,
        handler: jest.fn(),
      });

      // Wait for initial poll to complete
      await Promise.resolve();
      await Promise.resolve();

      // Clear the mock to count only calls after unsubscribe
      (ReceiveMessageCommand as unknown as jest.Mock).mockClear();

      await provider.unsubscribe(queueName);

      // Verify interval was cleared - advance timers and no new calls should be made
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      // Should not have attempted to receive messages after unsubscribe
      expect(ReceiveMessageCommand).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should handle unsubscribe from non-subscribed queue', async () => {
      await expect(provider.unsubscribe('non-existent')).resolves.not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up all polling intervals', async () => {
      jest.useFakeTimers();

      const queueName1 = 'queue-1';
      const queueName2 = 'queue-2';
      const queueUrl1 = 'http://localhost:4566/000000000000/queue-1';
      const queueUrl2 = 'http://localhost:4566/000000000000/queue-2';

      // Setup mocks: getQueueUrl responses first, then receiveMessage responses
      // We need to ensure getQueueUrl calls happen before receiveMessage calls
      let getQueueUrlCallCount = 0;
      mockSend.mockImplementation((command) => {
        // Check if it's a GetQueueUrlCommand
        if (command instanceof GetQueueUrlCommand) {
          getQueueUrlCallCount++;
          if (getQueueUrlCallCount === 1) {
            return Promise.resolve({ QueueUrl: queueUrl1 });
          } else if (getQueueUrlCallCount === 2) {
            return Promise.resolve({ QueueUrl: queueUrl2 });
          }
        }
        // For ReceiveMessageCommand or any other command, return empty messages
        return Promise.resolve({ Messages: [] });
      });

      await provider.subscribe({
        queueName: queueName1,
        handler: jest.fn(),
      });

      // Wait for first subscription's operations to complete
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await provider.subscribe({
        queueName: queueName2,
        handler: jest.fn(),
      });

      // Wait for second subscription's operations to complete
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Clear the mock call count before destroy
      (ReceiveMessageCommand as unknown as jest.Mock).mockClear();

      provider.onModuleDestroy();

      // Advance timers - should not process after destroy
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      // Should not have attempted to receive messages after destroy
      expect(ReceiveMessageCommand).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
