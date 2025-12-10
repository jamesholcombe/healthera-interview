import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueModule } from './queue/queue.module';
import { QueueProvider } from './queue/interfaces/queue';

const queueProvider = (process.env.QUEUE_PROVIDER || 'sqs') as QueueProvider;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    QueueModule.forRoot({
      provider: queueProvider,
      sqs: {
        region: process.env.AWS_REGION || '',
        endpoint: process.env.AWS_ENDPOINT_URL || '',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
      rabbitmq: {
        url: process.env.RABBITMQ_URL || '',
      },
    }),
  ],
})
export class AppModule {}
