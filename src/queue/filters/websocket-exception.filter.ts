import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ValidationError } from 'class-validator';
import {
  QueueError,
  QueueNotFoundError,
  QueueCreationError,
  QueuePublishError,
  QueueSubscribeError,
} from '../errors/queue.errors';

@Catch(WsException, QueueError)
export class WebSocketExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WebSocketExceptionFilter.name);

  catch(exception: WsException | QueueError, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    let errorMessage: string = 'An unexpected error occurred';
    let errorDetails: string[] = [];
    let queueName: string | undefined;

    if (exception instanceof WsException) {
      // Handle validation errors and other WebSocket exceptions
      const error = exception.getError();

      // Check if error is an array of ValidationError objects (from ValidationPipe)
      if (
        Array.isArray(error) &&
        error.length > 0 &&
        this.isValidationError(error[0])
      ) {
        errorDetails = this.formatValidationErrors(error as ValidationError[]);
        errorMessage = 'Validation failed';
        this.logger.warn(
          `WebSocket validation error for client ${client.id}: ${errorMessage}`,
        );
      } else if (typeof error === 'string') {
        errorMessage = error;
        this.logger.warn(
          `WebSocket error for client ${client.id}: ${errorMessage}`,
        );
      } else if (typeof error === 'object' && error !== null) {
        // Handle object errors
        const errorObj = error as { message?: string | string[] };
        if (Array.isArray(errorObj.message)) {
          errorDetails = errorObj.message;
          errorMessage = 'Validation failed';
        } else {
          errorMessage = errorObj.message || 'An error occurred';
        }
        this.logger.warn(
          `WebSocket error for client ${client.id}: ${errorMessage}`,
        );
      } else {
        errorMessage = 'An error occurred';
        this.logger.warn(
          `WebSocket error for client ${client.id}: ${errorMessage}`,
        );
      }
    } else if (exception instanceof QueueError) {
      // Handle queue service errors
      errorMessage = exception.message;
      queueName = exception.queueName;

      if (exception instanceof QueueNotFoundError) {
        this.logger.warn(
          `Queue not found for client ${client.id}: ${queueName}`,
        );
      } else if (exception instanceof QueueCreationError) {
        this.logger.error(
          `Queue creation error for client ${client.id}: ${queueName}`,
          exception.stack,
        );
      } else if (exception instanceof QueuePublishError) {
        this.logger.error(
          `Queue publish error for client ${client.id}: ${queueName}`,
          exception.stack,
        );
      } else if (exception instanceof QueueSubscribeError) {
        this.logger.error(
          `Queue subscribe error for client ${client.id}: ${queueName}`,
          exception.stack,
        );
      } else {
        this.logger.error(
          `Queue error for client ${client.id}: ${errorMessage}`,
          exception.stack,
        );
      }
    }

    client.emit('queue:error', {
      error: errorMessage,
      details: errorDetails.length > 0 ? errorDetails : undefined,
      queueName,
    });
  }

  private isValidationError(error: unknown): error is ValidationError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'property' in error &&
      'constraints' in error
    );
  }

  private formatValidationErrors(errors: ValidationError[]): string[] {
    const messages: string[] = [];
    for (const error of errors) {
      if (error.constraints) {
        messages.push(...Object.values(error.constraints));
      }
      // Handle nested validation errors
      if (error.children && error.children.length > 0) {
        messages.push(...this.formatValidationErrors(error.children));
      }
    }
    return messages;
  }
}
