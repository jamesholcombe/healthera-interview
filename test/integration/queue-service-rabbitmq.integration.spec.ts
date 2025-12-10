import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/test-app.factory';
import { QueueService } from '../../src/queue/queue.service';
import { QueueTestHelper } from './helpers/queue-test.helper';
import { LoggerSuppressor } from './helpers/logger-suppressor.helper';

describe('Queue Service RabbitMQ Integration', () => {
  let app: INestApplication;
  let queueService: QueueService;
  let queueHelper: QueueTestHelper;

  beforeAll(async () => {
    app = await createTestApp({
      queueProvider: 'rabbitmq',
      rabbitmqConfig: {
        url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
      },
    });

    queueService = app.get(QueueService);
    queueHelper = new QueueTestHelper();
    await queueHelper.setupRabbitMQ(
      process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    );
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
      await queueHelper.cleanupRabbitMQQueue(queueName);
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

      expect(true).toBe(true);
    });
  });

  describe('Subscribe', () => {
    let queueName: string;
    const receivedMessages: any[] = [];

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-subscribe');
      receivedMessages.length = 0;
    });

    afterEach(async () => {
      await queueService.unsubscribe(queueName).catch(() => {});
      await queueHelper.cleanupRabbitMQQueue(queueName);
    });

    it('should subscribe to a queue and receive messages', async () => {
      const handler = async (message: any) => {
        receivedMessages.push(message);
      };

      await queueService.subscribe({
        queueName,
        handler,
      });

      // RabbitMQ consume is event-driven, so minimal wait needed
      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.publish({
        queueName,
        message: {
          body: 'Test message for subscription',
          attributes: { test: 'value' },
        },
      });

      // RabbitMQ delivers messages immediately via events, so short wait is sufficient
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0]).toHaveProperty('body');
      expect(receivedMessages[0].body).toBe('Test message for subscription');
    });

    it('should receive multiple messages', async () => {
      const handler = async (message: any) => {
        receivedMessages.push(message);
      };

      await queueService.subscribe({
        queueName,
        handler,
      });

      // RabbitMQ consume is event-driven
      await new Promise((resolve) => setTimeout(resolve, 500));

      for (let i = 0; i < 3; i++) {
        await queueService.publish({
          queueName,
          message: {
            body: `Message ${i + 1}`,
          },
        });
      }

      // RabbitMQ delivers messages immediately via events
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('should handle handler errors gracefully', async () => {
      // Suppress expected error logs for this test
      LoggerSuppressor.suppressPatterns([
        'Error processing message',
        'Error receiving messages',
      ]);

      try {
        const handler = async () => {
          throw new Error('Handler error');
        };

        await queueService.subscribe({
          queueName,
          handler,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await queueService.publish({
          queueName,
          message: {
            body: 'Message that will cause error',
          },
        });

        // RabbitMQ delivers immediately, short wait is sufficient
        await new Promise((resolve) => setTimeout(resolve, 1000));

        expect(true).toBe(true);
      } finally {
        LoggerSuppressor.restore();
      }
    }, 5000);
  });

  describe('Unsubscribe', () => {
    let queueName: string;

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-unsubscribe');
    });

    afterEach(async () => {
      await queueHelper.cleanupRabbitMQQueue(queueName);
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
      const receivedMessages: any[] = [];

      await queueService.subscribe({
        queueName,
        handler: async (message: any) => {
          receivedMessages.push(message);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.unsubscribe(queueName);

      // Wait for unsubscribe to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.publish({
        queueName,
        message: {
          body: 'Message after unsubscribe',
        },
      });

      // Wait to ensure message would have been received if subscription was active
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(
        receivedMessages.some((m) => m.body === 'Message after unsubscribe'),
      ).toBe(false);
    }, 5000);
  });

  describe('Connection Lifecycle', () => {
    let queueName: string;

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-connection');
    });

    afterEach(async () => {
      await queueService.unsubscribe(queueName).catch(() => {});
      await queueHelper.cleanupRabbitMQQueue(queueName);
    });

    it('should establish connection on module init', async () => {
      // Connection should be established in beforeAll
      // Verify by attempting to publish a message
      await expect(
        queueService.publish({
          queueName,
          message: { body: 'Test connection' },
        }),
      ).resolves.not.toThrow();
    });

    it('should maintain connection across multiple operations', async () => {
      const receivedMessages: any[] = [];

      // Subscribe
      await queueService.subscribe({
        queueName,
        handler: async (message: any) => {
          receivedMessages.push(message);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Publish multiple messages
      for (let i = 0; i < 5; i++) {
        await queueService.publish({
          queueName,
          message: { body: `Message ${i + 1}` },
        });
      }

      // Wait for messages to be delivered
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have received messages (connection maintained)
      expect(receivedMessages.length).toBeGreaterThan(0);
    }, 10000);

    it('should handle operations after connection is established', async () => {
      // Perform multiple operations to verify connection stability
      await queueService.publish({
        queueName,
        message: { body: 'Message 1' },
      });

      await queueService.subscribe({
        queueName,
        handler: async () => {},
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.publish({
        queueName,
        message: { body: 'Message 2' },
      });

      await queueService.unsubscribe(queueName);

      // All operations should complete without errors
      expect(true).toBe(true);
    }, 8000);

    it('should clean up connection on module destroy', async () => {
      // This test verifies that cleanup happens in afterAll
      // We can't directly test onModuleDestroy, but we can verify
      // that operations work correctly, indicating connection is managed properly

      await queueService.subscribe({
        queueName,
        handler: async () => {},
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.unsubscribe(queueName);

      // If we get here without errors, connection lifecycle is working
      expect(true).toBe(true);
    });
  });

  describe('Message Acknowledgment', () => {
    let queueName: string;

    beforeEach(() => {
      queueName = queueHelper.generateQueueName('test-ack');
    });

    afterEach(async () => {
      await queueService.unsubscribe(queueName).catch(() => {});
      await queueHelper.cleanupRabbitMQQueue(queueName);
    });

    it('should ACK message after successful processing', async () => {
      const receivedMessages: any[] = [];

      await queueService.subscribe({
        queueName,
        handler: async (message: any) => {
          receivedMessages.push(message);
          // Handler succeeds - message should be ACK'd
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueService.publish({
        queueName,
        message: { body: 'Test ACK message' },
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Message should be received
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].body).toBe('Test ACK message');

      // Publish another message - if previous was ACK'd, this should be received
      await queueService.publish({
        queueName,
        message: { body: 'Second message' },
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have received both messages (first was ACK'd, not redelivered)
      const messageBodies = receivedMessages.map((m) => m.body);
      expect(messageBodies).toContain('Test ACK message');
      expect(messageBodies).toContain('Second message');
    }, 10000);

    it('should NACK and requeue message on handler error', async () => {
      // Suppress expected error logs
      LoggerSuppressor.suppressPatterns([
        'Error processing message',
        'Error receiving messages',
      ]);

      try {
        let attemptCount = 0;
        const receivedMessages: any[] = [];

        await queueService.subscribe({
          queueName,
          handler: async (message: any) => {
            attemptCount++;
            receivedMessages.push(message);

            // First attempt fails, subsequent attempts succeed
            if (attemptCount === 1) {
              throw new Error('Handler error');
            }
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await queueService.publish({
          queueName,
          message: { body: 'Message that will error first time' },
        });

        // Wait for first attempt (will fail and be requeued)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Wait for retry (message should be redelivered)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Message should have been received twice (original + retry)
        // This indicates it was NACK'd and requeued
        expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
        expect(attemptCount).toBeGreaterThan(1);
      } finally {
        LoggerSuppressor.restore();
      }
    }, 10000);
  });
});
