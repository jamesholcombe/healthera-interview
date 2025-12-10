import {
  QueueError,
  QueueNotFoundError,
  QueueCreationError,
  QueuePublishError,
  QueueSubscribeError,
} from './queue.errors';

describe('Queue Errors', () => {
  describe('QueueError', () => {
    it('should create an error with message', () => {
      const error = new QueueError('Test error');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(QueueError);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('QueueError');
      expect(error.queueName).toBeUndefined();
    });

    it('should create an error with message and queue name', () => {
      const error = new QueueError('Test error', 'test-queue');
      expect(error.message).toBe('Test error');
      expect(error.queueName).toBe('test-queue');
    });
  });

  describe('QueueNotFoundError', () => {
    it('should create a not found error with queue name', () => {
      const error = new QueueNotFoundError('test-queue');
      expect(error).toBeInstanceOf(QueueError);
      expect(error).toBeInstanceOf(QueueNotFoundError);
      expect(error.message).toBe('Queue "test-queue" does not exist');
      expect(error.name).toBe('QueueNotFoundError');
      expect(error.queueName).toBe('test-queue');
    });
  });

  describe('QueueCreationError', () => {
    it('should create a creation error without cause', () => {
      const error = new QueueCreationError('test-queue');
      expect(error).toBeInstanceOf(QueueError);
      expect(error).toBeInstanceOf(QueueCreationError);
      expect(error.message).toBe(
        'Failed to create queue "test-queue": Unknown error',
      );
      expect(error.name).toBe('QueueCreationError');
      expect(error.queueName).toBe('test-queue');
    });

    it('should create a creation error with cause', () => {
      const cause = new Error('Connection failed');
      const error = new QueueCreationError('test-queue', cause);
      expect(error.message).toBe(
        'Failed to create queue "test-queue": Connection failed',
      );
      expect(error.queueName).toBe('test-queue');
    });
  });

  describe('QueuePublishError', () => {
    it('should create a publish error without cause', () => {
      const error = new QueuePublishError('test-queue');
      expect(error).toBeInstanceOf(QueueError);
      expect(error).toBeInstanceOf(QueuePublishError);
      expect(error.message).toBe(
        'Failed to publish message to queue "test-queue": Unknown error',
      );
      expect(error.name).toBe('QueuePublishError');
      expect(error.queueName).toBe('test-queue');
    });

    it('should create a publish error with cause', () => {
      const cause = new Error('Invalid message format');
      const error = new QueuePublishError('test-queue', cause);
      expect(error.message).toBe(
        'Failed to publish message to queue "test-queue": Invalid message format',
      );
      expect(error.queueName).toBe('test-queue');
    });
  });

  describe('QueueSubscribeError', () => {
    it('should create a subscribe error without cause', () => {
      const error = new QueueSubscribeError('test-queue');
      expect(error).toBeInstanceOf(QueueError);
      expect(error).toBeInstanceOf(QueueSubscribeError);
      expect(error.message).toBe(
        'Failed to subscribe to queue "test-queue": Unknown error',
      );
      expect(error.name).toBe('QueueSubscribeError');
      expect(error.queueName).toBe('test-queue');
    });

    it('should create a subscribe error with cause', () => {
      const cause = new Error('Queue does not exist');
      const error = new QueueSubscribeError('test-queue', cause);
      expect(error.message).toBe(
        'Failed to subscribe to queue "test-queue": Queue does not exist',
      );
      expect(error.queueName).toBe('test-queue');
    });
  });
});
