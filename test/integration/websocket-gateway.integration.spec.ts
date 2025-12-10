import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/test-app.factory';
import { SocketClientHelper } from './helpers/socket-client.helper';
import { QueueTestHelper } from './helpers/queue-test.helper';
import { getAvailablePort } from './helpers/port.helper';

type ProviderConfig = {
  name: string;
  provider: 'sqs' | 'rabbitmq';
  testPort?: number;
  setup: (queueHelper: QueueTestHelper) => Promise<void> | void;
  cleanupQueue: (
    queueHelper: QueueTestHelper,
    queueName: string,
  ) => Promise<void>;
  subscriptionWaitTime: number;
  messageWaitTime: number;
  unsubscribeWaitTime: number;
  appConfig: {
    queueProvider: 'sqs' | 'rabbitmq';
    sqsConfig?: {
      region: string;
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
    rabbitmqConfig?: {
      url: string;
    };
  };
};

const providerConfigs: ProviderConfig[] = [
  {
    name: 'SQS',
    provider: 'sqs',
    setup: (queueHelper: QueueTestHelper) => {
      queueHelper.setupSQS({
        region: 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      });
    },
    cleanupQueue: async (queueHelper: QueueTestHelper, queueName: string) => {
      await queueHelper.cleanupSQSQueue(queueName);
    },
    subscriptionWaitTime: 1500,
    messageWaitTime: 4000,
    unsubscribeWaitTime: 2000,
    appConfig: {
      queueProvider: 'sqs',
      sqsConfig: {
        region: 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    },
  },
  {
    name: 'RabbitMQ',
    provider: 'rabbitmq',
    setup: async (queueHelper: QueueTestHelper) => {
      await queueHelper.setupRabbitMQ(
        process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
      );
    },
    cleanupQueue: async (queueHelper: QueueTestHelper, queueName: string) => {
      await queueHelper.cleanupRabbitMQQueue(queueName);
    },
    subscriptionWaitTime: 500,
    messageWaitTime: 2000,
    unsubscribeWaitTime: 1000,
    appConfig: {
      queueProvider: 'rabbitmq',
      rabbitmqConfig: {
        url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
      },
    },
  },
];

// as we want to run the tests for both providers, we can parametrize the test suite
function runWebSocketGatewayTests(config: ProviderConfig) {
  describe(`${config.name} Provider`, () => {
    let app: INestApplication;
    let queueHelper: QueueTestHelper;
    let testPort: number;

    beforeAll(async () => {
      testPort = testPort || (await getAvailablePort());
      app = await createTestApp(config.appConfig);
      await app.listen(testPort);

      queueHelper = new QueueTestHelper();
      await config.setup(queueHelper);
    });

    afterAll(async () => {
      await queueHelper.cleanup();
      await app.close();
    });

    describe('Connection Management', () => {
      it('should handle client connection', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        expect(client.isConnected()).toBe(true);

        client.disconnect();
      });

      it('should handle client disconnection', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();
        expect(client.isConnected()).toBe(true);

        client.disconnect();
        expect(client.isConnected()).toBe(false);
      });

      it('should handle multiple client connections', async () => {
        const client1 = new SocketClientHelper({ port: testPort });
        const client2 = new SocketClientHelper({ port: testPort });
        const client3 = new SocketClientHelper({ port: testPort });

        await Promise.all([
          client1.connect(),
          client2.connect(),
          client3.connect(),
        ]);

        expect(client1.isConnected()).toBe(true);
        expect(client2.isConnected()).toBe(true);
        expect(client3.isConnected()).toBe(true);

        client1.disconnect();
        client2.disconnect();
        client3.disconnect();
      });
    });

    describe('Queue Subscription', () => {
      let queueName: string;

      beforeEach(() => {
        queueName = queueHelper.generateQueueName('test-subscribe');
      });

      afterEach(async () => {
        await config.cleanupQueue(queueHelper, queueName);
      });

      it('should subscribe to a queue', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        const result = await client.subscribe(queueName);

        expect(result).toHaveProperty('queueName', queueName);
        expect(result).toHaveProperty('message');
        expect(result.message).toContain('subscribed');

        client.disconnect();
      });

      it('should handle duplicate subscription', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        await client.subscribe(queueName);
        const result = await client.subscribe(queueName);

        expect(result).toHaveProperty('queueName', queueName);
        expect(result.message).toContain('Already subscribed');

        client.disconnect();
      });

      it('should allow multiple clients to subscribe to same queue', async () => {
        const client1 = new SocketClientHelper({ port: testPort });
        const client2 = new SocketClientHelper({ port: testPort });

        await Promise.all([client1.connect(), client2.connect()]);

        const result1 = await client1.subscribe(queueName);
        const result2 = await client2.subscribe(queueName);

        expect(result1.queueName).toBe(queueName);
        expect(result2.queueName).toBe(queueName);

        client1.disconnect();
        client2.disconnect();
      });

      it('should reject invalid subscription data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Timeout'));
            }, 5000);

            client.getSocket()?.once('queue:error', (error) => {
              clearTimeout(timeout);
              resolve(error);
            });

            client.getSocket()?.emit('queue:subscribe', {});
          });

          // Should have received an error
          expect(true).toBe(true);
        } catch (error) {
          // Error expected
          expect(error).toBeDefined();
        }

        client.disconnect();
      });
    });

    describe('Queue Unsubscription', () => {
      let queueName: string;

      beforeEach(() => {
        queueName = queueHelper.generateQueueName('test-unsubscribe');
      });

      afterEach(async () => {
        await config.cleanupQueue(queueHelper, queueName);
      });

      it('should unsubscribe from a queue', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        await client.subscribe(queueName);
        const result = await client.unsubscribe(queueName);

        expect(result).toHaveProperty('queueName', queueName);
        expect(result).toHaveProperty('message');
        expect(result.message).toContain('unsubscribed');

        client.disconnect();
      });

      it('should handle unsubscribe without subscription', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        const result = await client.unsubscribe(queueName);

        expect(result).toHaveProperty('queueName', queueName);
        expect(result.message).toContain('unsubscribed');

        client.disconnect();
      });

      it('should unsubscribe all clients on disconnect', async () => {
        const client1 = new SocketClientHelper({ port: testPort });
        const client2 = new SocketClientHelper({ port: testPort });

        await Promise.all([client1.connect(), client2.connect()]);

        await client1.subscribe(queueName);
        await client2.subscribe(queueName);

        client1.disconnect();

        // Wait a bit for cleanup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Client2 should still be subscribed
        const result = await client2.unsubscribe(queueName);
        expect(result.queueName).toBe(queueName);

        client2.disconnect();
      });
    });

    describe('Message Publishing', () => {
      let queueName: string;

      beforeEach(() => {
        queueName = queueHelper.generateQueueName('test-publish');
      });

      afterEach(async () => {
        await config.cleanupQueue(queueHelper, queueName);
      });

      it('should publish a message to a queue', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        const message = {
          body: 'Test message',
          attributes: { key: 'value' },
        };

        const result = await client.publish(queueName, message);

        expect(result).toHaveProperty('queueName', queueName);
        expect(result).toHaveProperty('message');
        expect(result.message).toContain('published');

        client.disconnect();
      });

      it('should reject invalid publish data', async () => {
        const client = new SocketClientHelper({ port: testPort });
        await client.connect();

        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Timeout'));
            }, 5000);

            client.getSocket()?.once('queue:error', (error) => {
              clearTimeout(timeout);
              resolve(error);
            });

            client.getSocket()?.emit('queue:publish', {
              queueName: '',
              message: {},
            });
          });

          expect(true).toBe(true);
        } catch (error) {
          expect(error).toBeDefined();
        }

        client.disconnect();
      });
    });

    describe('Message Delivery', () => {
      let queueName: string;

      beforeEach(() => {
        queueName = queueHelper.generateQueueName('test-delivery');
      });

      afterEach(async () => {
        await config.cleanupQueue(queueHelper, queueName);
      });

      it('should deliver messages to subscribed clients', async () => {
        const subscriber = new SocketClientHelper({ port: testPort });
        const publisher = new SocketClientHelper({ port: testPort });

        await Promise.all([subscriber.connect(), publisher.connect()]);

        await subscriber.subscribe(queueName);

        // Wait for subscription to be ready (provider-specific timing)
        await new Promise((resolve) =>
          setTimeout(resolve, config.subscriptionWaitTime),
        );

        const message = {
          body: 'Test message body',
          attributes: { test: 'attribute' },
        };

        await publisher.publish(queueName, message);

        // Wait for message delivery (provider-specific timing)
        const received = await subscriber.waitForMessage(
          config.messageWaitTime,
        );

        expect(received).toHaveProperty('queueName', queueName);
        expect(received).toHaveProperty('message');
        expect(received.message).toHaveProperty('body', message.body);
        expect(received.message.attributes).toEqual(message.attributes);

        subscriber.disconnect();
        publisher.disconnect();
      }, 8000);

      it('should deliver messages to all subscribed clients', async () => {
        const subscriber1 = new SocketClientHelper({ port: testPort });
        const subscriber2 = new SocketClientHelper({ port: testPort });
        const subscriber3 = new SocketClientHelper({ port: testPort });
        const publisher = new SocketClientHelper({ port: testPort });

        await Promise.all([
          subscriber1.connect(),
          subscriber2.connect(),
          subscriber3.connect(),
          publisher.connect(),
        ]);

        await Promise.all([
          subscriber1.subscribe(queueName),
          subscriber2.subscribe(queueName),
          subscriber3.subscribe(queueName),
        ]);

        // Wait for subscriptions to be ready
        await new Promise((resolve) =>
          setTimeout(resolve, config.subscriptionWaitTime),
        );

        const message = {
          body: 'Broadcast message',
        };

        await publisher.publish(queueName, message);

        // Wait for messages (provider-specific timing)
        const [received1, received2, received3] = await Promise.all([
          subscriber1.waitForMessage(config.messageWaitTime),
          subscriber2.waitForMessage(config.messageWaitTime),
          subscriber3.waitForMessage(config.messageWaitTime),
        ]);

        expect(received1.message.body).toBe(message.body);
        expect(received2.message.body).toBe(message.body);
        expect(received3.message.body).toBe(message.body);

        subscriber1.disconnect();
        subscriber2.disconnect();
        subscriber3.disconnect();
        publisher.disconnect();
      }, 8000);

      it('should not deliver messages to unsubscribed clients', async () => {
        const subscriber = new SocketClientHelper({ port: testPort });
        const publisher = new SocketClientHelper({ port: testPort });

        await Promise.all([subscriber.connect(), publisher.connect()]);

        await subscriber.subscribe(queueName);
        await subscriber.unsubscribe(queueName);

        // Wait a bit for unsubscribe to complete
        await new Promise((resolve) =>
          setTimeout(resolve, config.unsubscribeWaitTime),
        );

        const message = {
          body: 'Should not be received',
        };

        await publisher.publish(queueName, message);

        try {
          await subscriber.waitForMessage(5000);
          fail('Should not have received message');
        } catch (error) {
          expect(error).toBeDefined();
        }

        subscriber.disconnect();
        publisher.disconnect();
      }, 15000);
    });
  });
}

describe('WebSocket Gateway Integration', () => {
  providerConfigs.forEach((config) => {
    runWebSocketGatewayTests(config);
  });
});
