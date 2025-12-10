import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';
import * as amqp from 'amqplib';

export interface HealthCheckOptions {
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

/**
 * Check if SQS (LocalStack) is available
 */
async function checkSQSHealth(
  config: NonNullable<HealthCheckOptions['sqs']>,
): Promise<boolean> {
  try {
    const client = new SQSClient({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.accessKeyId
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey || '',
          }
        : undefined,
    });

    // Try to list queues - this will fail if SQS is not available
    await client.send(new ListQueuesCommand({}));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if RabbitMQ is available
 */
async function checkRabbitMQHealth(
  config: NonNullable<HealthCheckOptions['rabbitmq']>,
): Promise<boolean> {
  try {
    const connection = await amqp.connect(config.url);
    await connection.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a service to become available with retries
 */
async function waitForService(
  checkFn: () => Promise<boolean>,
  serviceName: string,
  maxRetries: number = 10,
  retryDelay: number = 1000,
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    if (await checkFn()) {
      return;
    }
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  throw new Error(
    `${serviceName} is not available after ${maxRetries} attempts. Please ensure the service is running.`,
  );
}

/**
 * Check health of required services for tests
 * @param options Service configurations to check
 * @param wait If true, wait for services to become available (default: false)
 * @throws Error if services are not available
 */
export async function checkTestServicesHealth(
  options: HealthCheckOptions,
  wait: boolean = false,
): Promise<void> {
  const errors: string[] = [];

  if (options.sqs) {
    const isHealthy = await checkSQSHealth(options.sqs);
    if (!isHealthy) {
      if (wait) {
        try {
          await waitForService(
            () => checkSQSHealth(options.sqs!),
            'SQS (LocalStack)',
          );
        } catch (error) {
          errors.push(
            error instanceof Error
              ? error.message
              : 'SQS (LocalStack) unavailable',
          );
        }
      } else {
        errors.push(
          'SQS (LocalStack) is not available. Please ensure LocalStack is running (docker-compose up -d)',
        );
      }
    }
  }

  if (options.rabbitmq) {
    const isHealthy = await checkRabbitMQHealth(options.rabbitmq);
    if (!isHealthy) {
      if (wait) {
        try {
          await waitForService(
            () => checkRabbitMQHealth(options.rabbitmq!),
            'RabbitMQ',
          );
        } catch (error) {
          errors.push(
            error instanceof Error ? error.message : 'RabbitMQ unavailable',
          );
        }
      } else {
        errors.push(
          'RabbitMQ is not available. Please ensure RabbitMQ is running (docker-compose up -d)',
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Test services health check failed:\n${errors.join('\n')}\n\n` +
        'To start services, run: docker-compose up -d',
    );
  }
}
