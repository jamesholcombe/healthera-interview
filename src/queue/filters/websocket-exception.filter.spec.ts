import { ArgumentsHost } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ValidationError } from 'class-validator';
import { WebSocketExceptionFilter } from './websocket-exception.filter';
import {
  QueueError,
  QueueNotFoundError,
  QueueCreationError,
  QueuePublishError,
  QueueSubscribeError,
} from '../errors/queue.errors';

describe('WebSocketExceptionFilter', () => {
  let filter: WebSocketExceptionFilter;
  let mockClient: jest.Mocked<Socket>;
  let mockArgumentsHost: jest.Mocked<ArgumentsHost>;

  beforeEach(() => {
    filter = new WebSocketExceptionFilter();
    mockClient = {
      id: 'test-client-id',
      emit: jest.fn(),
    } as unknown as jest.Mocked<Socket>;

    mockArgumentsHost = {
      switchToWs: jest.fn().mockReturnValue({
        getClient: jest.fn().mockReturnValue(mockClient),
        getData: jest.fn(),
      }),
    } as unknown as jest.Mocked<ArgumentsHost>;
  });

  const catchException = (exception: WsException | QueueError) => {
    filter.catch(exception, mockArgumentsHost);
  };

  describe('WsException', () => {
    it('should handle WsException with string message', () => {
      const exception = new WsException('WebSocket error occurred');

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'WebSocket error occurred',
        details: undefined,
        queueName: undefined,
      });
    });

    it('should handle WsException with validation errors array', () => {
      const validationErrors: ValidationError[] = [
        {
          property: 'queueName',
          constraints: {
            isString: 'queueName must be a string',
            isNotEmpty: 'queueName should not be empty',
          },
        },
      ];
      const exception = new WsException(validationErrors);

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Validation failed',
        details: [
          'queueName must be a string',
          'queueName should not be empty',
        ],
        queueName: undefined,
      });
    });

    it('should handle WsException with nested validation errors', () => {
      const validationErrors: ValidationError[] = [
        {
          property: 'message',
          constraints: {
            isObject: 'message must be an object',
          },
          children: [
            {
              property: 'body',
              constraints: {
                isString: 'body must be a string',
              },
            },
          ],
        },
      ];
      const exception = new WsException(validationErrors);

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Validation failed',
        details: ['message must be an object', 'body must be a string'],
        queueName: undefined,
      });
    });

    it('should handle WsException with object error', () => {
      const exception = new WsException({
        message: 'Custom validation error',
      });

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Custom validation error',
        details: undefined,
        queueName: undefined,
      });
    });

    it('should handle WsException with object error containing array message', () => {
      const exception = new WsException({
        message: ['Error 1', 'Error 2'],
      });

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Validation failed',
        details: ['Error 1', 'Error 2'],
        queueName: undefined,
      });
    });
  });

  describe('QueueError', () => {
    it('should handle QueueNotFoundError', () => {
      const exception = new QueueNotFoundError('test-queue');

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Queue "test-queue" does not exist',
        details: undefined,
        queueName: 'test-queue',
      });
    });

    it('should handle QueueCreationError', () => {
      const cause = new Error('Connection failed');
      const exception = new QueueCreationError('test-queue', cause);

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Failed to create queue "test-queue": Connection failed',
        details: undefined,
        queueName: 'test-queue',
      });
    });

    it('should handle QueuePublishError', () => {
      const cause = new Error('Invalid message format');
      const exception = new QueuePublishError('test-queue', cause);

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error:
          'Failed to publish message to queue "test-queue": Invalid message format',
        details: undefined,
        queueName: 'test-queue',
      });
    });

    it('should handle QueueSubscribeError', () => {
      const cause = new Error('Queue does not exist');
      const exception = new QueueSubscribeError('test-queue', cause);

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error:
          'Failed to subscribe to queue "test-queue": Queue does not exist',
        details: undefined,
        queueName: 'test-queue',
      });
    });

    it('should handle generic QueueError', () => {
      const exception = new QueueError('Generic queue error', 'test-queue');

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Generic queue error',
        details: undefined,
        queueName: 'test-queue',
      });
    });

    it('should handle QueueError without queueName', () => {
      const exception = new QueueError('Generic queue error');

      catchException(exception);

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        error: 'Generic queue error',
        details: undefined,
        queueName: undefined,
      });
    });
  });
});
