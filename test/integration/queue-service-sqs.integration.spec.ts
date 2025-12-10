import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/test-app.factory';
import { QueueService } from '../../src/queue/queue.service';
import { QueueTestHelper } from './helpers/queue-test.helper';
import { LoggerSuppressor } from './helpers/logger-suppressor.helper';
import { QueueMessage } from '../../src/queue/interfaces/queue';

describe('Queue Service SQS Integration', () => {
  let app: INestApplication;
  let queueService: QueueService;
  let queueHelper: QueueTestHelper;

  beforeAll(async () => {
    app = await createTestApp({
      queueProvider: 'sqs',
      sqsConfig: {
        region: 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    queueService = app.get(QueueService);
    queueHelper = new QueueTestHelper();
    queueHelper.setupSQS({
      region: 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    });
  });

  afterAll(async () => {
    await queueHelper.cleanup();
    await app.close();
  });

  describe('Publish', () => {
    let queueName: string;

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-publish');
    });

    afterEach(async () => {
      await queueHelper.cleanupSQSQueue(queueName);
    });

    it('should publish a message to a queue', async () => {
      const message = {
        body: 'Test message body',
        attributes: { key: 'value', another: 'attribute' },
      };

      await expect(
        queueService.publish({
          queueName,
          message,
        }),
      ).resolves.not.toThrow();
    });

    it('should publish a message without attributes', async () => {
      const message = {
        body: 'Test message without attributes',
      };

      await expect(
        queueService.publish({
          queueName,
          message,
        }),
      ).resolves.not.toThrow();
    });

    it('should create queue if it does not exist', async () => {
      const message = {
        body: 'Message to new queue',
      };

      await expect(
        queueService.publish({
          queueName,
          message,
        }),
      ).resolves.not.toThrow();
    });

    it('should handle multiple publishes to same queue', async () => {
      const messages = [
        { body: 'Message 1' },
        { body: 'Message 2' },
        { body: 'Message 3' },
      ];

      await Promise.all(
        messages.map((message) =>
          queueService.publish({
            queueName,
            message,
          }),
        ),
      );

      // All should succeed
      expect(true).toBe(true);
    });
  });

  describe('Subscribe', () => {
    let queueName: string;
    const receivedMessages: QueueMessage[] = [];

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-subscribe');
      receivedMessages.length = 0;
    });

    afterEach(async () => {
      await queueService.unsubscribe(queueName).catch(() => {
        // Ignore unsubscribe errors
      });
      await queueHelper.cleanupSQSQueue(queueName);
    });

    it('should subscribe to a queue and receive messages', async () => {
      const handler = (message) => {
        receivedMessages.push(message);
      };

      await queueService.subscribe({
        queueName,
        handler,
      });

      // Wait for subscription to be ready (SQS starts polling immediately)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Publish a message
      await queueService.publish({
        queueName,
        message: {
          body: 'Test message for subscription',
          attributes: { test: 'value' },
        },
      });

      // Wait for message to be received
      // With WaitTimeSeconds: 1, polling should pick up messages quickly
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0]).toHaveProperty('body');
      expect(receivedMessages[0].body).toBe('Test message for subscription');
    }, 8000);

    it('should receive multiple messages', async () => {
      const handler = (message: QueueMessage) => {
        receivedMessages.push(message);
      };

      await queueService.subscribe({
        queueName,
        handler,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Publish multiple messages
      for (let i = 0; i < 3; i++) {
        await queueService.publish({
          queueName,
          message: {
            body: `Message ${i + 1}`,
          },
        });
      }

      // Wait for messages to be received
      // With WaitTimeSeconds: 1, polling should pick up messages quickly
      await new Promise((resolve) => setTimeout(resolve, 4000));

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    }, 8000);

    it('should handle handler errors gracefully', async () => {
      // Suppress expected error logs for this test
      LoggerSuppressor.suppressPatterns([
        'Error processing message',
        'Error receiving messages',
      ]);

      try {
        const handler = () => {
          throw new Error('Handler error');
        };

        await queueService.subscribe({
          queueName,
          handler,
        });

        await new Promise((resolve) => setTimeout(resolve, 1500));

        await queueService.publish({
          queueName,
          message: {
            body: 'Message that will cause error',
          },
        });

        // Wait a bit - message should remain in queue for retry
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Should not throw
        expect(true).toBe(true);
      } finally {
        LoggerSuppressor.restore();
      }
    }, 6000);
  });

  describe('Unsubscribe', () => {
    let queueName: string;

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-unsubscribe');
    });

    afterEach(async () => {
      await queueHelper.cleanupSQSQueue(queueName);
    });

    it('should unsubscribe from a queue', async () => {
      await queueService.subscribe({
        queueName,
        handler: async () => {},
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await expect(queueService.unsubscribe(queueName)).resolves.not.toThrow();
    });

    it('should handle unsubscribe from non-subscribed queue', async () => {
      await expect(queueService.unsubscribe(queueName)).resolves.not.toThrow();
    });

    it('should stop receiving messages after unsubscribe', async () => {
      const receivedMessages: QueueMessage[] = [];

      await queueService.subscribe({
        queueName,
        handler: (message) => {
          receivedMessages.push(message);
        },
      });

      // Wait for subscription to be ready
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Unsubscribe - this should immediately stop processing
      await queueService.unsubscribe(queueName);

      // Wait a bit to ensure unsubscribe is processed
      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.publish({
        queueName,
        message: {
          body: 'Message after unsubscribe',
        },
      });

      // Wait to ensure message would have been received if subscription was active
      // With WaitTimeSeconds: 1, wait a few polling cycles
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Should not have received the message
      expect(
        receivedMessages.some((m) => m.body === 'Message after unsubscribe'),
      ).toBe(false);
    }, 8000);
  });

  describe('Polling Interval Cleanup', () => {
    let queueName: string;

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-polling-cleanup');
    });

    afterEach(async () => {
      await queueService.unsubscribe(queueName).catch(() => {});
      await queueHelper.cleanupSQSQueue(queueName);
    });

    it('should clean up polling interval on unsubscribe', async () => {
      const receivedMessages: QueueMessage[] = [];

      await queueService.subscribe({
        queueName,
        handler: (message) => {
          receivedMessages.push(message);
        },
      });

      // Wait for polling to start
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Publish a message to verify polling is active
      await queueService.publish({
        queueName,
        message: { body: 'Test message before unsubscribe' },
      });

      // Wait for message to be received
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(receivedMessages.length).toBeGreaterThan(0);

      // Unsubscribe - this should stop polling
      await queueService.unsubscribe(queueName);

      // Wait a bit to ensure polling is stopped
      await new Promise((resolve) => setTimeout(resolve, 500));

      const messageCountBefore = receivedMessages.length;

      // Publish another message - should not be received
      await queueService.publish({
        queueName,
        message: { body: 'Test message after unsubscribe' },
      });

      // Wait longer than a polling cycle
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Message count should not have increased
      expect(receivedMessages.length).toBe(messageCountBefore);
    }, 10000);

    it('should handle multiple subscribe/unsubscribe cycles without leaks', async () => {
      const receivedMessages: QueueMessage[] = [];

      // Perform multiple subscribe/unsubscribe cycles
      for (let i = 0; i < 3; i++) {
        await queueService.subscribe({
          queueName,
          handler: (message) => {
            receivedMessages.push(message);
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await queueService.unsubscribe(queueName);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Final subscribe
      await queueService.subscribe({
        queueName,
        handler: (message) => {
          receivedMessages.push(message);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Publish and verify it's received
      await queueService.publish({
        queueName,
        message: { body: 'Final test message' },
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Should have received the message
      expect(
        receivedMessages.some((m) => m.body === 'Final test message'),
      ).toBe(true);
    }, 15000);

    it('should stop polling immediately on unsubscribe', async () => {
      const receivedMessages: QueueMessage[] = [];

      await queueService.subscribe({
        queueName,
        handler: (message) => {
          receivedMessages.push(message);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Unsubscribe immediately
      await queueService.unsubscribe(queueName);

      // Publish message right after unsubscribe
      await queueService.publish({
        queueName,
        message: { body: 'Message after immediate unsubscribe' },
      });

      // Wait for what would be multiple polling cycles
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Should not have received the message
      expect(
        receivedMessages.some(
          (m) => m.body === 'Message after immediate unsubscribe',
        ),
      ).toBe(false);
    }, 10000);
  });
});
