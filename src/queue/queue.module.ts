import { DynamicModule, Module, Provider } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueGateway } from './queue.gateway';
import type { QueueProvider } from './interfaces/queue';
import { SqsProvider } from './providers/sqs.provider';
import { RabbitMqProvider } from './providers/rabbitmq.provider';

export interface QueueModuleOptions {
  provider: QueueProvider;
  sqs?: {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  rabbitmq?: {
    url: string;
  };
}
//https://docs.nestjs.com/fundamentals/dynamic-modules#example
//using pattern from nestjs documentation on dynamic modules.
// this allows us to modify how the queue module is configured without having to change the code.
@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    const { provider, sqs, rabbitmq } = options;

    const providers: Provider[] = [QueueService];

    const providerConfig = {
      sqs: {
        config: sqs,
        configToken: 'SQS_CONFIG',
        providerClass: SqsProvider,
        errorMessage: 'SQS configuration is required when using SQS provider',
      },
      rabbitmq: {
        config: rabbitmq,
        configToken: 'RABBITMQ_CONFIG',
        providerClass: RabbitMqProvider,
        errorMessage:
          'RabbitMQ configuration is required when using RabbitMQ provider',
      },
    } as const;

    const selected = providerConfig[provider];

    if (!selected.config) {
      throw new Error(selected.errorMessage);
    }

    providers.push({
      provide: selected.configToken,
      useValue: selected.config,
    });

    providers.push(selected.providerClass);

    providers.push({
      provide: 'QUEUE_PROVIDER',
      useExisting: selected.providerClass,
    });

    return {
      module: QueueModule,
      providers: [...providers, QueueGateway],
      exports: [QueueService],
    };
  }
}
