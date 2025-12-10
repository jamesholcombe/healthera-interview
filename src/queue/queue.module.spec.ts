import { Test, TestingModule } from '@nestjs/testing';
import { QueueModule } from './queue.module';
import { QueueService } from './queue.service';
import { QueueGateway } from './queue.gateway';
import { SqsProvider } from './providers/sqs.provider';
import { RabbitMqProvider } from './providers/rabbitmq.provider';

describe('QueueModule', () => {
  describe('forRoot with SQS provider', () => {
    it('should create a dynamic module with SQS provider', () => {
      const dynamicModule = QueueModule.forRoot({
        provider: 'sqs',
        sqs: {
          region: 'us-east-1',
          endpoint: 'http://localhost:4566',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      });

      expect(dynamicModule.module).toBe(QueueModule);
      expect(dynamicModule.providers).toContain(QueueService);
      expect(dynamicModule.providers).toContain(QueueGateway);
      expect(dynamicModule.providers).toContain(SqsProvider);
      expect(dynamicModule.exports).toContain(QueueService);
    });

    it('should register SQS config provider', async () => {
      const dynamicModule = QueueModule.forRoot({
        provider: 'sqs',
        sqs: {
          region: 'us-east-1',
          endpoint: 'http://localhost:4566',
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        imports: [dynamicModule],
      }).compile();

      const sqsConfig = module.get('SQS_CONFIG');
      expect(sqsConfig).toEqual({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
      });

      const queueProvider = module.get('QUEUE_PROVIDER');
      expect(queueProvider).toBeInstanceOf(SqsProvider);
    });

    it('should throw error when SQS config is missing', () => {
      expect(() => {
        QueueModule.forRoot({
          provider: 'sqs',
        });
      }).toThrow('SQS configuration is required when using SQS provider');
    });
  });

  describe('forRoot with RabbitMQ provider', () => {
    it('should create a dynamic module with RabbitMQ provider', () => {
      const dynamicModule = QueueModule.forRoot({
        provider: 'rabbitmq',
        rabbitmq: {
          url: 'amqp://localhost:5672',
        },
      });

      expect(dynamicModule.module).toBe(QueueModule);
      expect(dynamicModule.providers).toContain(QueueService);
      expect(dynamicModule.providers).toContain(QueueGateway);
      expect(dynamicModule.providers).toContain(RabbitMqProvider);
      expect(dynamicModule.exports).toContain(QueueService);
    });

    it('should register RabbitMQ config provider', async () => {
      const dynamicModule = QueueModule.forRoot({
        provider: 'rabbitmq',
        rabbitmq: {
          url: 'amqp://localhost:5672',
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        imports: [dynamicModule],
      }).compile();

      const rabbitmqConfig = module.get('RABBITMQ_CONFIG');
      expect(rabbitmqConfig).toEqual({
        url: 'amqp://localhost:5672',
      });

      const queueProvider = module.get('QUEUE_PROVIDER');
      expect(queueProvider).toBeInstanceOf(RabbitMqProvider);
    });

    it('should throw error when RabbitMQ config is missing', () => {
      expect(() => {
        QueueModule.forRoot({
          provider: 'rabbitmq',
        });
      }).toThrow(
        'RabbitMQ configuration is required when using RabbitMQ provider',
      );
    });
  });

  describe('module integration', () => {
    it('should provide QueueService that uses SQS provider', async () => {
      const dynamicModule = QueueModule.forRoot({
        provider: 'sqs',
        sqs: {
          region: 'us-east-1',
          endpoint: 'http://localhost:4566',
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        imports: [dynamicModule],
      }).compile();

      const queueService = module.get<QueueService>(QueueService);
      expect(queueService).toBeDefined();
      expect(queueService).toBeInstanceOf(QueueService);
    });

    it('should provide QueueService that uses RabbitMQ provider', async () => {
      const dynamicModule = QueueModule.forRoot({
        provider: 'rabbitmq',
        rabbitmq: {
          url: 'amqp://localhost:5672',
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        imports: [dynamicModule],
      }).compile();

      const queueService = module.get<QueueService>(QueueService);
      expect(queueService).toBeDefined();
      expect(queueService).toBeInstanceOf(QueueService);
    });
  });
});
