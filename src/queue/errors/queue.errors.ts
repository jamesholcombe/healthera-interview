export class QueueError extends Error {
  constructor(
    message: string,
    public readonly queueName?: string,
  ) {
    super(message);
    this.name = 'QueueError';
    Object.setPrototypeOf(this, QueueError.prototype);
  }
}

export class QueueNotFoundError extends QueueError {
  constructor(queueName: string) {
    super(`Queue "${queueName}" does not exist`, queueName);
    this.name = 'QueueNotFoundError';
    Object.setPrototypeOf(this, QueueNotFoundError.prototype);
  }
}

export class QueueCreationError extends QueueError {
  constructor(queueName: string, cause?: Error) {
    super(
      `Failed to create queue "${queueName}": ${cause?.message || 'Unknown error'}`,
      queueName,
    );
    this.name = 'QueueCreationError';
    Object.setPrototypeOf(this, QueueCreationError.prototype);
  }
}

export class QueuePublishError extends QueueError {
  constructor(queueName: string, cause?: Error) {
    super(
      `Failed to publish message to queue "${queueName}": ${cause?.message || 'Unknown error'}`,
      queueName,
    );
    this.name = 'QueuePublishError';
    Object.setPrototypeOf(this, QueuePublishError.prototype);
  }
}

export class QueueSubscribeError extends QueueError {
  constructor(queueName: string, cause?: Error) {
    super(
      `Failed to subscribe to queue "${queueName}": ${cause?.message || 'Unknown error'}`,
      queueName,
    );
    this.name = 'QueueSubscribeError';
    Object.setPrototypeOf(this, QueueSubscribeError.prototype);
  }
}
