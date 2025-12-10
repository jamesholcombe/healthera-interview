import { Test, TestingModule } from '@nestjs/testing';
import { QueueGateway } from './queue.gateway';
import { QueueService } from './queue.service';
import { Server, Socket } from 'socket.io';
import { QueueMessage } from './interfaces/queue';
import {
  QueueNotFoundError,
  QueuePublishError,
  QueueSubscribeError,
} from './errors/queue.errors';

describe('QueueGateway', () => {
  let gateway: QueueGateway;
  let mockQueueService: jest.Mocked<QueueService>;
  let mockServer: jest.Mocked<Server>;
  let mockSocket: jest.Mocked<Socket>;
  let mockSocketsMap: Map<string, Socket>;

  beforeEach(async () => {
    mockSocketsMap = new Map();
    mockSocket = {
      id: 'test-client-id',
      emit: jest.fn(),
    } as unknown as jest.Mocked<Socket>;

    mockServer = {
      sockets: {
        sockets: mockSocketsMap,
      },
    } as unknown as jest.Mocked<Server>;

    mockQueueService = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<QueueService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueGateway,
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    gateway = module.get<QueueGateway>(QueueGateway);
    gateway.server = mockServer;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should log connection and initialize client subscriptions', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      gateway.handleConnection(mockSocket);

      expect(logSpy).toHaveBeenCalledWith(`Client connected: ${mockSocket.id}`);
      expect(gateway['clientSubscriptions'].has(mockSocket.id)).toBe(true);
      expect(gateway['clientSubscriptions'].get(mockSocket.id)?.size).toBe(0);
    });
  });

  describe('handleDisconnect', () => {
    it('should log disconnection and clean up subscriptions', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');
      gateway['clientSubscriptions'].set(mockSocket.id, new Set(['queue1']));
      gateway['queueHandlers'].set('queue1', jest.fn());

      gateway.handleDisconnect(mockSocket);

      expect(logSpy).toHaveBeenCalledWith(
        `Client disconnected: ${mockSocket.id}`,
      );
      expect(gateway['clientSubscriptions'].has(mockSocket.id)).toBe(false);
    });

    it('should unsubscribe from all queues on disconnect', () => {
      gateway['clientSubscriptions'].set(
        mockSocket.id,
        new Set(['queue1', 'queue2']),
      );
      const unsubscribeSpy = jest.spyOn(gateway as any, 'unsubscribeFromQueue');

      gateway.handleDisconnect(mockSocket);

      expect(unsubscribeSpy).toHaveBeenCalledTimes(2);
      expect(unsubscribeSpy).toHaveBeenCalledWith(mockSocket, 'queue1');
      expect(unsubscribeSpy).toHaveBeenCalledWith(mockSocket, 'queue2');
    });
  });

  describe('handleSubscribe', () => {
    it('should subscribe client to queue successfully', async () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      await gateway.handleSubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      expect(mockQueueService.subscribe).toHaveBeenCalledTimes(1);
      expect(mockSocket.emit).toHaveBeenCalledWith('queue:subscribed', {
        queueName: 'test-queue',
        message: 'Successfully subscribed to queue',
      });
      expect(logSpy).toHaveBeenCalledWith(
        `Client ${mockSocket.id} subscribed to queue: test-queue`,
      );
      expect(
        gateway['clientSubscriptions'].get(mockSocket.id)?.has('test-queue'),
      ).toBe(true);
    });

    it('should return early if already subscribed', async () => {
      gateway['clientSubscriptions'].set(
        mockSocket.id,
        new Set(['test-queue']),
      );

      await gateway.handleSubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      expect(mockQueueService.subscribe).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('queue:subscribed', {
        queueName: 'test-queue',
        message: 'Already subscribed to this queue',
      });
    });

    it('should create handler and subscribe to queue service on first subscription', async () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      await gateway.handleSubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      expect(mockQueueService.subscribe).toHaveBeenCalledWith({
        queueName: 'test-queue',
        handler: expect.any(Function),
      });
      expect(logSpy).toHaveBeenCalledWith(
        `Queue subscription created: test-queue`,
      );
      expect(gateway['queueHandlers'].has('test-queue')).toBe(true);
    });

    it('should not create new handler if queue already has handler', async () => {
      const existingHandler = jest.fn();
      gateway['queueHandlers'].set('test-queue', existingHandler);
      gateway['clientSubscriptions'].set(
        'other-client',
        new Set(['test-queue']),
      );

      await gateway.handleSubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      expect(mockQueueService.subscribe).not.toHaveBeenCalled();
      expect(gateway['queueHandlers'].get('test-queue')).toBe(existingHandler);
    });

    it('should deliver messages to all subscribed clients', async () => {
      const client1 = { id: 'client1', emit: jest.fn() } as unknown as Socket;
      const client2 = { id: 'client2', emit: jest.fn() } as unknown as Socket;
      mockSocketsMap.set('client1', client1);
      mockSocketsMap.set('client2', client2);

      gateway['clientSubscriptions'].set('client1', new Set(['test-queue']));
      gateway['clientSubscriptions'].set('client2', new Set(['test-queue']));

      await gateway.handleSubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      const handler = gateway['queueHandlers'].get('test-queue');
      expect(handler).toBeDefined();

      const testMessage: QueueMessage = {
        body: 'test message',
        id: 'msg-1',
      };

      handler?.(testMessage);

      expect(client1.emit).toHaveBeenCalledWith('queue:message', {
        queueName: 'test-queue',
        message: testMessage,
      });
      expect(client2.emit).toHaveBeenCalledWith('queue:message', {
        queueName: 'test-queue',
        message: testMessage,
      });
    });

    it('should propagate QueueSubscribeError', async () => {
      const error = new QueueSubscribeError('test-queue');
      mockQueueService.subscribe.mockRejectedValue(error);

      await expect(
        gateway.handleSubscribe(mockSocket, {
          queueName: 'test-queue',
        }),
      ).rejects.toThrow(QueueSubscribeError);
    });
  });

  describe('handleUnsubscribe', () => {
    it('should unsubscribe client from queue', () => {
      gateway['clientSubscriptions'].set(
        mockSocket.id,
        new Set(['test-queue']),
      );

      gateway.handleUnsubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:unsubscribed', {
        queueName: 'test-queue',
        message: 'Successfully unsubscribed from queue',
      });
      expect(
        gateway['clientSubscriptions'].get(mockSocket.id)?.has('test-queue'),
      ).toBe(false);
    });

    it('should handle unsubscribe when not subscribed', () => {
      gateway['clientSubscriptions'].set(mockSocket.id, new Set());

      gateway.handleUnsubscribe(mockSocket, {
        queueName: 'test-queue',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:unsubscribed', {
        queueName: 'test-queue',
        message: 'Successfully unsubscribed from queue',
      });
    });
  });

  describe('handlePublish', () => {
    it('should publish message successfully', async () => {
      const message: QueueMessage = {
        body: 'test message',
        id: 'msg-1',
      };

      await gateway.handlePublish(mockSocket, {
        queueName: 'test-queue',
        message,
      });

      expect(mockQueueService.publish).toHaveBeenCalledWith({
        queueName: 'test-queue',
        message,
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('queue:published', {
        queueName: 'test-queue',
        message: 'Message published successfully',
      });
    });

    it('should propagate QueuePublishError', async () => {
      const error = new QueuePublishError('test-queue');
      mockQueueService.publish.mockRejectedValue(error);

      await expect(
        gateway.handlePublish(mockSocket, {
          queueName: 'test-queue',
          message: { body: 'test' },
        }),
      ).rejects.toThrow(QueuePublishError);
    });

    it('should propagate QueueNotFoundError', async () => {
      const error = new QueueNotFoundError('test-queue');
      mockQueueService.publish.mockRejectedValue(error);

      await expect(
        gateway.handlePublish(mockSocket, {
          queueName: 'test-queue',
          message: { body: 'test' },
        }),
      ).rejects.toThrow(QueueNotFoundError);
    });
  });

  describe('unsubscribeFromQueue', () => {
    it('should remove subscription and unsubscribe from service when no other clients', async () => {
      gateway['clientSubscriptions'].set(
        mockSocket.id,
        new Set(['test-queue']),
      );
      gateway['queueHandlers'].set('test-queue', jest.fn());
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      gateway['unsubscribeFromQueue'](mockSocket, 'test-queue');

      expect(
        gateway['clientSubscriptions'].get(mockSocket.id)?.has('test-queue'),
      ).toBe(false);

      // Wait for async unsubscribe
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockQueueService.unsubscribe).toHaveBeenCalledWith('test-queue');
      expect(gateway['queueHandlers'].has('test-queue')).toBe(false);
      expect(logSpy).toHaveBeenCalledWith(
        `Queue subscription removed (no more clients): test-queue`,
      );
    });

    it('should not unsubscribe from service when other clients are subscribed', () => {
      gateway['clientSubscriptions'].set(
        mockSocket.id,
        new Set(['test-queue']),
      );
      gateway['clientSubscriptions'].set(
        'other-client',
        new Set(['test-queue']),
      );
      // Set up the handler so it exists when we check
      gateway['queueHandlers'].set('test-queue', jest.fn());

      gateway['unsubscribeFromQueue'](mockSocket, 'test-queue');

      expect(mockQueueService.unsubscribe).not.toHaveBeenCalled();
      expect(gateway['queueHandlers'].has('test-queue')).toBe(true);
    });

    it('should handle unsubscribe errors gracefully', async () => {
      gateway['clientSubscriptions'].set(
        mockSocket.id,
        new Set(['test-queue']),
      );
      const error = new Error('Unsubscribe failed');
      mockQueueService.unsubscribe.mockRejectedValue(error);
      const errorSpy = jest.spyOn(gateway['logger'], 'error');

      gateway['unsubscribeFromQueue'](mockSocket, 'test-queue');

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledWith(
        `Error unsubscribing from queue test-queue:`,
        error,
      );
    });

    it('should return early if client is not subscribed', () => {
      gateway['clientSubscriptions'].set(mockSocket.id, new Set());

      gateway['unsubscribeFromQueue'](mockSocket, 'test-queue');

      expect(mockQueueService.unsubscribe).not.toHaveBeenCalled();
    });
  });
});
