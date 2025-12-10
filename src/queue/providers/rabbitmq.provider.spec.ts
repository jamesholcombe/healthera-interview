import { Test, TestingModule } from '@nestjs/testing';
import { RabbitMqProvider } from './rabbitmq.provider';
import * as amqp from 'amqplib';

// Mock amqplib
jest.mock('amqplib');

describe('RabbitMqProvider', () => {
  let provider: RabbitMqProvider;
  let mockConnection: any;
  let mockChannel: any;

  const mockConfig = {
    url: 'amqp://guest:guest@localhost:5672',
  };

  beforeEach(async () => {
    // Create mock channel
    mockChannel = {
      assertQueue: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn().mockReturnValue(true),
      consume: jest.fn().mockResolvedValue({ consumerTag: 'consumer-tag-1' }),
      cancel: jest.fn().mockResolvedValue(undefined),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Create mock connection
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // Mock amqplib.connect
    (amqp.connect as jest.Mock).mockResolvedValue(mockConnection);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMqProvider,
        {
          provide: 'RABBITMQ_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    provider = module.get<RabbitMqProvider>(RabbitMqProvider);
  });

  afterEach(async () => {
    try {
      await provider.onModuleDestroy();
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should connect to RabbitMQ on module init', async () => {
      await provider.onModuleInit();

      expect(amqp.connect).toHaveBeenCalledWith(mockConfig.url);
      expect(mockConnection.createChannel).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      (amqp.connect as jest.Mock).mockRejectedValueOnce(error);

      await expect(provider.onModuleInit()).rejects.toThrow(
        'Connection failed',
      );
    });
  });

  describe('publish', () => {
    beforeEach(async () => {
      await provider.onModuleInit();
    });

    it('should publish a message to a queue', async () => {
      const queueName = 'test-queue';

      await provider.publish({
        queueName,
        message: {
          body: 'test message',
          attributes: { key: 'value' },
        },
      });

      expect(mockChannel.assertQueue).toHaveBeenCalledWith(queueName, {
        durable: true,
      });
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        queueName,
        Buffer.from('test message'),
        {
          persistent: true,
          headers: { key: 'value' },
        },
      );
    });

    it('should publish message without attributes', async () => {
      const queueName = 'test-queue';

      await provider.publish({
        queueName,
        message: { body: 'test message' },
      });

      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        queueName,
        Buffer.from('test message'),
        {
          persistent: true,
          headers: {},
        },
      );
    });

    it('should throw error if sendToQueue returns false', async () => {
      const queueName = 'test-queue';
      mockChannel.sendToQueue.mockReturnValueOnce(false);

      await expect(
        provider.publish({
          queueName,
          message: { body: 'test message' },
        }),
      ).rejects.toThrow('Failed to send message to queue');
    });

    it('should reconnect if channel is not available', async () => {
      // First, initialize the provider
      await provider.onModuleInit();

      // Simulate disconnected state by clearing the connection
      (provider as any).channel = undefined;
      (provider as any).connection = undefined;

      // Reset the mock call count
      (amqp.connect as jest.Mock).mockClear();

      const queueName = 'test-queue';

      await provider.publish({
        queueName,
        message: { body: 'test message' },
      });

      // Should have reconnected (connect called again)
      expect(amqp.connect).toHaveBeenCalled();
      expect(mockChannel.assertQueue).toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    beforeEach(async () => {
      await provider.onModuleInit();
    });

    it('should subscribe to a queue', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockResolvedValue(undefined);

      await provider.subscribe({
        queueName,
        handler,
      });

      expect(mockChannel.assertQueue).toHaveBeenCalledWith(queueName, {
        durable: true,
      });
      expect(mockChannel.consume).toHaveBeenCalledWith(
        queueName,
        expect.any(Function),
        { noAck: false },
      );
    });

    it('should process received messages', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockResolvedValue(undefined);

      let consumeCallback: (msg: any) => void;

      mockChannel.consume.mockImplementation(
        (q: string, callback: (msg: any) => void) => {
          consumeCallback = callback;
          return Promise.resolve({ consumerTag: 'consumer-tag-1' });
        },
      );

      await provider.subscribe({
        queueName,
        handler,
      });

      // Simulate message received
      const mockMessage = {
        content: Buffer.from('test message'),
        properties: {
          messageId: 'msg-1',
          headers: { key: 'value' },
        },
      };

      // Call the consume callback
      consumeCallback!(mockMessage);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith({
        id: 'msg-1',
        body: 'test message',
        attributes: { key: 'value' },
      });
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should handle handler errors and nack message', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));

      let consumeCallback: (msg: any) => void;

      mockChannel.consume.mockImplementation(
        (q: string, callback: (msg: any) => void) => {
          consumeCallback = callback;
          return Promise.resolve({ consumerTag: 'consumer-tag-1' });
        },
      );

      await provider.subscribe({
        queueName,
        handler,
      });

      const mockMessage = {
        content: Buffer.from('test message'),
        properties: {
          messageId: 'msg-1',
          headers: {},
        },
      };

      consumeCallback!(mockMessage);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, true);
    });

    it('should cancel existing consumer before subscribing', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockResolvedValue(undefined);

      // First subscription
      await provider.subscribe({
        queueName,
        handler,
      });

      // Second subscription should cancel first
      await provider.subscribe({
        queueName,
        handler,
      });

      expect(mockChannel.cancel).toHaveBeenCalledWith('consumer-tag-1');
    });

    it('should handle null message in consume callback', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockResolvedValue(undefined);

      let consumeCallback: (msg: any) => void;

      mockChannel.consume.mockImplementation(
        (q: string, callback: (msg: any) => void) => {
          consumeCallback = callback;
          return Promise.resolve({ consumerTag: 'consumer-tag-1' });
        },
      );

      await provider.subscribe({
        queueName,
        handler,
      });

      // Call with null message (connection closed)
      consumeCallback!(null);

      // Should not throw or call handler
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    beforeEach(async () => {
      await provider.onModuleInit();
    });

    it('should unsubscribe from a queue', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockResolvedValue(undefined);

      await provider.subscribe({
        queueName,
        handler,
      });

      await provider.unsubscribe(queueName);

      expect(mockChannel.cancel).toHaveBeenCalledWith('consumer-tag-1');
    });

    it('should handle unsubscribe from non-subscribed queue', async () => {
      await expect(provider.unsubscribe('non-existent')).resolves.not.toThrow();
    });

    it('should handle unsubscribe errors gracefully', async () => {
      const queueName = 'test-queue';
      const handler = jest.fn().mockResolvedValue(undefined);

      await provider.subscribe({
        queueName,
        handler,
      });

      mockChannel.cancel.mockRejectedValueOnce(new Error('Cancel failed'));

      // The provider logs the error but still throws it
      await expect(provider.unsubscribe(queueName)).rejects.toThrow(
        'Cancel failed',
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect and clean up all consumers', async () => {
      await provider.onModuleInit();

      const queueName1 = 'queue-1';
      const queueName2 = 'queue-2';
      const handler = jest.fn().mockResolvedValue(undefined);

      await provider.subscribe({ queueName: queueName1, handler });
      await provider.subscribe({ queueName: queueName2, handler });

      await provider.onModuleDestroy();

      expect(mockChannel.cancel).toHaveBeenCalledTimes(2);
      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      await provider.onModuleInit();

      mockChannel.close.mockRejectedValueOnce(new Error('Close failed'));

      // Should not throw
      await expect(provider.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
