// Suppress console errors and warnings during integration tests
// This prevents expected errors from cluttering test output
// Note: Individual tests can use LoggerSuppressor for more granular control

// Health check for test services (can be disabled with SKIP_HEALTH_CHECK=true)
// Note: This runs as a global setup - individual test suites can add their own checks
if (process.env.SKIP_HEALTH_CHECK !== 'true') {
  // Use a simple synchronous check that logs warnings
  // Full async health checks should be done in individual test suites
  const sqsEndpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  const rabbitmqUrl =
    process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

  console.log(
    '\n📋 Test Services Configuration:\n' +
      `  SQS Endpoint: ${sqsEndpoint}\n` +
      `  RabbitMQ URL: ${rabbitmqUrl}\n` +
      '  To skip health checks: SKIP_HEALTH_CHECK=true\n' +
      '  To start services: docker-compose up -d\n',
  );
}

const originalError = console.error;
const originalWarn = console.warn;

// Store original implementations
const suppressedErrorPatterns = [
  'Validation failed',
  'Queue not found',
  'Queue creation error',
  'Queue publish error',
  'Queue subscribe error',
  'WebSocket validation error',
  'WebSocket error',
  'Failed to publish message',
  'Failed to subscribe',
  'Error processing message',
  'Error receiving messages',
  'Error unsubscribing',
  'connect_error',
];

const suppressedWarnPatterns = [
  'WebSocket validation error',
  'Queue not found',
  'WebSocket error',
];

// Only suppress if we're in a test environment and the message matches patterns
// Using any[] here because Jest's mock function signature accepts any arguments
// and console.error can accept any number of arguments of any type

global.console.error = jest.fn((...args: any[]) => {
  const message = args[0]?.toString() || '';

  const shouldSuppress = suppressedErrorPatterns.some((pattern) =>
    message.includes(pattern),
  );

  if (!shouldSuppress) {
    originalError(...args);
  }
});

// Using any[] here because Jest's mock function signature accepts any arguments
// and console.warn can accept any number of arguments of any type

global.console.warn = jest.fn((...args: any[]) => {
  const message = args[0]?.toString() || '';

  const shouldSuppress = suppressedWarnPatterns.some((pattern) =>
    message.includes(pattern),
  );

  if (!shouldSuppress) {
    originalWarn(...args);
  }
});
