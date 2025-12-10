import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import type {
  QueueService as QueueServiceInterface,
  QueuePublishOptions,
  QueueSubscribeOptions,
} from './interfaces/queue';

describe('QueueService', () => {
  let service: QueueService;
  let mockProvider: jest.Mocked<QueueServiceInterface>;
  let mockPublish: jest.Mock<Promise<void>, [QueuePublishOptions]>;
  let mockSubscribe: jest.Mock<Promise<void>, [QueueSubscribeOptions]>;
  let mockUnsubscribe: jest.Mock<Promise<void>, [string]>;

  beforeEach(async () => {
    mockPublish = jest
      .fn<Promise<void>, [QueuePublishOptions]>()
      .mockResolvedValue(undefined);
    mockSubscribe = jest
      .fn<Promise<void>, [QueueSubscribeOptions]>()
      .mockResolvedValue(undefined);
    mockUnsubscribe = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);

    mockProvider = {
      publish: mockPublish,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: 'QUEUE_PROVIDER',
          useValue: mockProvider,
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publish', () => {
    it('should delegate to provider publish method', async () => {
      const options: QueuePublishOptions = {
        queueName: 'test-queue',
        message: {
          body: 'test message',
          attributes: { key: 'value' },
        },
      };

      await service.publish(options);

      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalledWith(options);
    });

    it('should propagate errors from provider', async () => {
      const error = new Error('Provider error');
      mockPublish.mockRejectedValue(error);

      const options: QueuePublishOptions = {
        queueName: 'test-queue',
        message: { body: 'test' },
      };

      await expect(service.publish(options)).rejects.toThrow('Provider error');
    });
  });

  describe('subscribe', () => {
    it('should delegate to provider subscribe method', async () => {
      const handler = jest.fn();
      const options: QueueSubscribeOptions = {
        queueName: 'test-queue',
        handler,
      };

      await service.subscribe(options);

      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(mockSubscribe).toHaveBeenCalledWith(options);
    });

    it('should propagate errors from provider', async () => {
      const error = new Error('Provider error');
      mockSubscribe.mockRejectedValue(error);

      const options: QueueSubscribeOptions = {
        queueName: 'test-queue',
        handler: jest.fn(),
      };

      await expect(service.subscribe(options)).rejects.toThrow(
        'Provider error',
      );
    });
  });

  describe('unsubscribe', () => {
    it('should delegate to provider unsubscribe method', async () => {
      const queueName = 'test-queue';

      await service.unsubscribe(queueName);

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      expect(mockUnsubscribe).toHaveBeenCalledWith(queueName);
    });

    it('should propagate errors from provider', async () => {
      const error = new Error('Provider error');
      mockUnsubscribe.mockRejectedValue(error);

      await expect(service.unsubscribe('test-queue')).rejects.toThrow(
        'Provider error',
      );
    });
  });
});
