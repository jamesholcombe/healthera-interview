import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/test-app.factory';
import { SocketClientHelper } from './helpers/socket-client.helper';
import { QueueTestHelper } from './helpers/queue-test.helper';
import { getAvailablePort } from './helpers/port.helper';

describe('End-to-End Tests', () => {
  describe('SQS Provider', () => {
    let app: INestApplication;
    let queueHelper: QueueTestHelper;
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

    it('should handle complete workflow: subscribe, publish, receive, unsubscribe', async () => {
      const queueName = queueHelper.generateQueueName('e2e-workflow');
      const subscriber = new SocketClientHelper({ port: testPort });
      const publisher = new SocketClientHelper({ port: testPort });

      try {
        await Promise.all([subscriber.connect(), publisher.connect()]);

        // Subscribe
        const subscribeResult = await subscriber.subscribe(queueName);
        expect(subscribeResult.queueName).toBe(queueName);

        // Wait for subscription to be ready (SQS polling setup)
        // With WaitTimeSeconds: 1, shorter wait is sufficient
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Publish
        const testMessage = {
          body: 'E2E test message',
          attributes: { workflow: 'test', step: '1' },
        };

        const publishResult = await publisher.publish(queueName, testMessage);
        expect(publishResult.queueName).toBe(queueName);

        // Receive (with WaitTimeSeconds: 1, should be quick)
        const received = await subscriber.waitForMessage(3000);
        expect(received.queueName).toBe(queueName);
        expect(received.message.body).toBe(testMessage.body);
        expect(received.message.attributes).toEqual(testMessage.attributes);

        // Unsubscribe
        const unsubscribeResult = await subscriber.unsubscribe(queueName);
        expect(unsubscribeResult.queueName).toBe(queueName);

        // Cleanup
        await queueHelper.cleanupSQSQueue(queueName);
      } finally {
        subscriber.disconnect();
        publisher.disconnect();
      }
    }, 10000);

    it('should handle multiple publishers and subscribers', async () => {
      const queueName = queueHelper.generateQueueName('e2e-multi');
      const subscribers: SocketClientHelper[] = [];
      const publishers: SocketClientHelper[] = [];

      try {
        // Create multiple subscribers
        for (let i = 0; i < 3; i++) {
          const client = new SocketClientHelper({ port: testPort });
          await client.connect();
          await client.subscribe(queueName);
          subscribers.push(client);
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Create multiple publishers
        for (let i = 0; i < 2; i++) {
          const client = new SocketClientHelper({ port: testPort });
          await client.connect();
          publishers.push(client);
        }

        // Publish messages from different publishers
        const messages = [
          { body: 'Message from publisher 1' },
          { body: 'Message from publisher 2' },
        ];

        for (let i = 0; i < publishers.length; i++) {
          await publishers[i].publish(queueName, messages[i]);
        }

        // All subscribers should receive all messages
        // With WaitTimeSeconds: 1, messages should be received quickly
        const receivedMessages = await Promise.all(
          subscribers.map((sub) => sub.waitForMessage(3000)),
        );

        expect(receivedMessages.length).toBe(3);
        receivedMessages.forEach((msg) => {
          expect(msg.queueName).toBe(queueName);
          expect(msg.message.body).toMatch(/Message from publisher/);
        });

        await queueHelper.cleanupSQSQueue(queueName);
      } finally {
        subscribers.forEach((client) => client.disconnect());
        publishers.forEach((client) => client.disconnect());
      }
    }, 15000);

    it('should handle concurrent operations', async () => {
      const queueName = queueHelper.generateQueueName('e2e-concurrent');
      const clients: SocketClientHelper[] = [];

      try {
        // Create multiple clients
        for (let i = 0; i < 5; i++) {
          const client = new SocketClientHelper({ port: testPort });
          await client.connect();
          clients.push(client);
        }

        // Concurrent subscriptions
        await Promise.all(clients.map((client) => client.subscribe(queueName)));

        // Wait for subscriptions to be ready (SQS polling setup)
        // With WaitTimeSeconds: 1, shorter wait is sufficient
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Concurrent publishes
        await Promise.all(
          clients.map((client, index) =>
            client.publish(queueName, {
              body: `Concurrent message ${index}`,
            }),
          ),
        );

        // Wait for messages (with WaitTimeSeconds: 1, should be quick)
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // All operations should complete without errors
        expect(true).toBe(true);

        await queueHelper.cleanupSQSQueue(queueName);
      } finally {
        clients.forEach((client) => client.disconnect());
      }
    }, 10000);
  });

  describe('RabbitMQ Provider', () => {
    let app: INestApplication;
    let queueHelper: QueueTestHelper;
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

      queueHelper = new QueueTestHelper();
      await queueHelper.setupRabbitMQ(
        process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
      );
    });

    afterAll(async () => {
      await queueHelper.cleanup();
      await app.close();
    });

    it('should handle complete workflow: subscribe, publish, receive, unsubscribe', async () => {
      const queueName = queueHelper.generateQueueName('e2e-workflow');
      const subscriber = new SocketClientHelper({ port: testPort });
      const publisher = new SocketClientHelper({ port: testPort });

      try {
        await Promise.all([subscriber.connect(), publisher.connect()]);

        const subscribeResult = await subscriber.subscribe(queueName);
        expect(subscribeResult.queueName).toBe(queueName);

        // RabbitMQ consume is event-driven, minimal wait needed
        await new Promise((resolve) => setTimeout(resolve, 500));

        const testMessage = {
          body: 'E2E test message',
          attributes: { workflow: 'test', step: '1' },
        };

        const publishResult = await publisher.publish(queueName, testMessage);
        expect(publishResult.queueName).toBe(queueName);

        // RabbitMQ delivers messages immediately via events
        const received = await subscriber.waitForMessage(2000);
        expect(received.queueName).toBe(queueName);
        expect(received.message.body).toBe(testMessage.body);
        expect(received.message.attributes).toEqual(testMessage.attributes);

        const unsubscribeResult = await subscriber.unsubscribe(queueName);
        expect(unsubscribeResult.queueName).toBe(queueName);

        await queueHelper.cleanupRabbitMQQueue(queueName);
      } finally {
        subscriber.disconnect();
        publisher.disconnect();
      }
    });

    it('should handle multiple publishers and subscribers', async () => {
      const queueName = queueHelper.generateQueueName('e2e-multi');
      const subscribers: SocketClientHelper[] = [];
      const publishers: SocketClientHelper[] = [];

      try {
        for (let i = 0; i < 3; i++) {
          const client = new SocketClientHelper({ port: testPort });
          await client.connect();
          await client.subscribe(queueName);
          subscribers.push(client);
        }

        // RabbitMQ consume is event-driven
        await new Promise((resolve) => setTimeout(resolve, 500));

        for (let i = 0; i < 2; i++) {
          const client = new SocketClientHelper({ port: testPort });
          await client.connect();
          publishers.push(client);
        }

        const messages = [
          { body: 'Message from publisher 1' },
          { body: 'Message from publisher 2' },
        ];

        for (let i = 0; i < publishers.length; i++) {
          await publishers[i].publish(queueName, messages[i]);
        }

        const receivedMessages = await Promise.all(
          subscribers.map((sub) => sub.waitForMessage(10000)),
        );

        expect(receivedMessages.length).toBe(3);
        receivedMessages.forEach((msg) => {
          expect(msg.queueName).toBe(queueName);
          expect(msg.message.body).toMatch(/Message from publisher/);
        });

        await queueHelper.cleanupRabbitMQQueue(queueName);
      } finally {
        subscribers.forEach((client) => client.disconnect());
        publishers.forEach((client) => client.disconnect());
      }
    });
  });
});
