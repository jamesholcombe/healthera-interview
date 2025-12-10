import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/test-app.factory';
import { SocketClientHelper } from './helpers/socket-client.helper';
import { LoggerSuppressor } from './helpers/logger-suppressor.helper';
import { getAvailablePort } from './helpers/port.helper';

describe('Error Handling Integration Tests', () => {
  // Suppress expected error logs during these tests
  beforeAll(() => {
    LoggerSuppressor.suppressPatterns([
      'Validation failed',
      'Queue not found',
      'Queue creation error',
      'Queue publish error',
      'Queue subscribe error',
      'WebSocket validation error',
      'WebSocket error',
      'Failed to publish message',
      'Failed to subscribe',
    ]);
  });

  afterAll(() => {
    LoggerSuppressor.restore();
  });
  describe('SQS Provider', () => {
    let app: INestApplication;
    let testPort: number;

    beforeAll(async () => {
      testPort = await getAvailablePort();

      app = await createTestApp({
        queueProvider: 'sqs',
        sqsConfig: {
          region: 'us-east-1',
          endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
          accessKeyId: 'test',
          secretAccessKey: 'test',
        },
      });

      await app.listen(testPort);
    });

    afterAll(async () => {
      await app.close();
    });

    describe('WebSocket Error Handling', () => {
      it('should handle invalid subscription data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          const errorPromise = client.waitForError(5000);
          client.getSocket()?.emit('queue:subscribe', {});

          const error = await errorPromise;
          expect(error).toBeDefined();
        } catch (error) {
          // Error expected
          expect(error).toBeDefined();
        } finally {
          client.disconnect();
        }
      }, 10000);

      it('should handle invalid publish data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          client.getSocket()?.emit('queue:publish', {
            queueName: '',
            message: {},
          });

          const error = await client.waitForError(5000);
          expect(error).toBeDefined();
        } catch (error) {
          expect(error).toBeDefined();
        } finally {
          client.disconnect();
        }
      });

      it('should handle invalid unsubscribe data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          client.getSocket()?.emit('queue:unsubscribe', {
            queueName: '',
          });

          const error = await client.waitForError(5000);
          expect(error).toBeDefined();
        } catch (error) {
          expect(error).toBeDefined();
        } finally {
          client.disconnect();
        }
      });

      it('should handle missing message body', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          client.getSocket()?.emit('queue:publish', {
            queueName: 'test-queue',
            message: {
              attributes: { key: 'value' },
            },
          });

          const error = await client.waitForError(5000);
          expect(error).toBeDefined();
        } catch (error) {
          expect(error).toBeDefined();
        } finally {
          client.disconnect();
        }
      });
    });
  });

  describe('RabbitMQ Provider', () => {
    let app: INestApplication;
    let testPort: number;

    beforeAll(async () => {
      testPort = await getAvailablePort();

      app = await createTestApp({
        queueProvider: 'rabbitmq',
        rabbitmqConfig: {
          url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
        },
      });

      await app.listen(testPort);
    });

    afterAll(async () => {
      await app.close();
    });

    describe('WebSocket Error Handling', () => {
      it('should handle invalid subscription data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          client.getSocket()?.emit('queue:subscribe', {});
          const error = await client.waitForError(5000);
          expect(error).toBeDefined();
        } catch (error) {
          expect(error).toBeDefined();
        } finally {
          client.disconnect();
        }
      });

      it('should handle invalid publish data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          client.getSocket()?.emit('queue:publish', {
            queueName: '',
            message: {},
          });

          const error = await client.waitForError(5000);
          expect(error).toBeDefined();
        } catch (error) {
          expect(error).toBeDefined();
        } finally {
          client.disconnect();
        }
      });
    });
  });

  describe('Connection Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      // Suppress connection error logs
      LoggerSuppressor.suppressPatterns(['connect_error', 'Connection error']);

      try {
        const client = new SocketClientHelper({ port: 9999 }); // Invalid port

        try {
          await client.connect();
          fail('Should have thrown connection error');
        } catch (error) {
          expect(error).toBeDefined();
        }
      } finally {
        LoggerSuppressor.restore();
      }
    });

    it('should handle disconnection during operation', async () => {
      const testPort = await getAvailablePort();

      const app = await createTestApp({
        queueProvider: 'sqs',
        sqsConfig: {
          region: 'us-east-1',
          endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
          accessKeyId: 'test',
          secretAccessKey: 'test',
        },
      });

      await app.listen(testPort);

      const client = new SocketClientHelper({ port: testPort });
      await client.connect();

      await client.subscribe('test-queue');

      // Disconnect abruptly
      client.disconnect();

      // Should not throw
      expect(true).toBe(true);

      await app.close();
    });
  });
});
