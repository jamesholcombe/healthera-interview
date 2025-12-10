import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueModule } from '../../../src/queue/queue.module';
import { QueueProvider } from '../../../src/queue/interfaces/queue';
import { WebSocketExceptionFilter } from '../../../src/queue/filters/websocket-exception.filter';

export interface TestAppOptions {
  queueProvider?: QueueProvider;
  sqsConfig?: {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  rabbitmqConfig?: {
    url: string;
  };
}

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<INestApplication> {
  const {
    queueProvider = 'sqs',
    sqsConfig = {
      region: 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
    rabbitmqConfig = {
      url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    },
  } = options;

  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
      }),
      QueueModule.forRoot({
        provider: queueProvider,
        sqs: sqsConfig,
        rabbitmq: rabbitmqConfig,
      }),
    ],
  })
  class TestAppModule {}

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Set logger to silent mode for tests to reduce noise
  app.useLogger(false);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new WebSocketExceptionFilter());

  await app.init();

  return app;
}
