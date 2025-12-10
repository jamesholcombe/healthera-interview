## Notes

I spent about 6 hours on this project. I am not super familiar with nest.js, so had to do a fair amount of reading docs and learning its rules and conventions.

I'm sure there are things that I could have done better, or might seem weird to those with lots of experience with nest.

I implemented the task with a websockets based API, as this seemed like the best choice for the brief to enable subscription to queues, and allow publishing of messages to the queues. 

I used Cursor as my primary tool to develop this, which allows me to develop at a higher velocity than if I was writing all code by hand. All code has been reviewed by me, and I take responsiblity and understanding for it.

I relied on it more for using the SQS and RabbitMQ APIs of which I was not familiar. I find it especially useful when performing boiler-plate tasks, such as scaffolding, writing tests that require alot of boiler plate code and writing docs (like the below sections).

## Description


A Nest.js API that can publish and subscribe to messages on a queue with support for multiple queue implementations (SQS, RabbitMQ). The queue provider can be swapped via environment variables without requiring any code changes.

## Features

- **Multiple Queue Providers**: Support for AWS SQS and RabbitMQ
- **Dynamic Module Configuration**: Swap queue providers via environment variables
- **No Code Changes Required**: Changing providers only requires environment variable updates
- **Dual API Support**: REST API for publishing and server-side subscriptions, WebSocket API for real-time client subscriptions
- **Docker Compose**: Local development environment with Localstack (SQS) and RabbitMQ

## Project setup

```bash
$ npm install
```

## Running the Application

### 1. Start Docker Services

Start Localstack (for SQS emulation) and RabbitMQ using Docker Compose:

```bash
$ docker-compose up -d
```

This will start:
- **Localstack** on port `4566` (SQS emulation)
- **RabbitMQ** on port `5672` (AMQP) and `15672` (Management UI)

### 2. Configure Environment Variables

Create a `.env` file or set environment variables:

#### For SQS (using Localstack):

```bash
QUEUE_PROVIDER=sqs
AWS_REGION=us-east-1
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
PORT=3000
```

#### For RabbitMQ:

```bash
QUEUE_PROVIDER=rabbitmq
RABBITMQ_URL=amqp://guest:guest@localhost:5672
PORT=3000
```

### 3. Run the Application

```bash
# development
$ npm run start:dev

# production mode
$ npm run start:prod
```

The WebSocket server will be available at `ws://localhost:3000`

## API Architecture

The API is **WebSocket-only** for all operations:
- **Publish messages** - Send messages to queues
- **Subscribe to queues** - Receive messages in real-time
- **Unsubscribe from queues** - Stop receiving messages

This unified approach provides a consistent, real-time interface for all queue operations.

## WebSocket API

All queue operations are performed via WebSocket connections. Connect to the WebSocket server at `ws://localhost:3000` using any WebSocket client library.

### Publish a Message

Publish messages to a queue:

```javascript
socket.emit('queue:publish', {
  queueName: 'my-queue',
  message: {
    body: 'Hello, World!',
    attributes: {
      key: 'value'
    }
  }
});
```

**Response events:**
- `queue:published` - Confirmation that message was published successfully
- `queue:error` - Error occurred during publishing

### Subscribe to a Queue

Send a `queue:subscribe` message:

```javascript
socket.emit('queue:subscribe', { queueName: 'my-queue' });
```

**Response events:**
- `queue:subscribed` - Confirmation that subscription was successful
- `queue:message` - Incoming message from the queue (you'll receive this for each message)
- `queue:error` - Error occurred during subscription

### Unsubscribe from a Queue

Send a `queue:unsubscribe` message:

```javascript
socket.emit('queue:unsubscribe', { queueName: 'my-queue' });
```

**Response events:**
- `queue:unsubscribed` - Confirmation that unsubscription was successful
- `queue:error` - Error occurred during unsubscription

### Example: JavaScript Client

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

// Connect to WebSocket
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
  
  // Subscribe to a queue
  socket.emit('queue:subscribe', { queueName: 'my-queue' });
  
  // Publish a message
  socket.emit('queue:publish', {
    queueName: 'my-queue',
    message: {
      body: 'Hello, World!',
      attributes: { source: 'client' }
    }
  });
});

// Listen for subscription confirmation
socket.on('queue:subscribed', (data) => {
  console.log('Subscribed to:', data.queueName);
});

// Listen for messages
socket.on('queue:message', (data) => {
  console.log('Received message:', data.message);
  console.log('From queue:', data.queueName);
});

// Listen for publish confirmation
socket.on('queue:published', (data) => {
  console.log('Message published:', data.message);
});

// Listen for errors
socket.on('queue:error', (error) => {
  console.error('Queue error:', error);
});

// Unsubscribe
socket.emit('queue:unsubscribe', { queueName: 'my-queue' });

socket.on('queue:unsubscribed', (data) => {
  console.log('Unsubscribed from:', data.queueName);
});
```

### Example: Node.js Client

```javascript
const { io } = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to WebSocket server');
  
  // Subscribe to queue
  socket.emit('queue:subscribe', { queueName: 'my-queue' });
  
  // Publish a message
  socket.emit('queue:publish', {
    queueName: 'my-queue',
    message: {
      body: 'Hello from Node.js!',
      attributes: { source: 'node-client' }
    }
  });
});

socket.on('queue:message', (data) => {
  console.log('Message received:', data.message);
});

socket.on('queue:published', (data) => {
  console.log('Message published successfully');
});

socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket server');
});
```

## Testing the Queue API

A test script is provided to verify the WebSocket queue API is working correctly.

### Prerequisites

1. Start Docker services:
```bash
docker-compose up -d
```

2. Start the NestJS server:
```bash
npm run start:dev
```

### Run the Test Script

```bash
npm run test:queue
```

The script will:
- Connect to the WebSocket server
- Subscribe to a test queue
- Publish a test message
- Receive the message
- Unsubscribe from the queue
- Display a summary of all operations

You can customize the test by setting environment variables:
```bash
SERVER_URL=http://localhost:3000 QUEUE_NAME=my-queue npm run test:queue
```

### Run tests

#### Prerequisites

Before running integration or e2e tests, ensure test services are running:

```bash
# Start LocalStack (SQS) and RabbitMQ
docker-compose up -d

# Verify services are running
docker-compose ps
```

#### Test Commands

```bash
# Run all unit tests
npm run test:unit

# Run all integration tests
npm run test:integration

# Run all e2e tests
npm run test:e2e

# Run all tests (unit + integration + e2e)
npm run test:all

# Run unit tests with coverage
npm run test:cov

# Run tests in watch mode
npm run test:watch

# Run tests in debug mode
npm run test:debug

# Run tests in CI mode (with coverage and limited workers)
npm run test:ci
```

#### Test Types

- **Unit Tests** (`*.spec.ts` in `src/`): Fast, isolated tests with mocked dependencies
- **Integration Tests** (`*.integration.spec.ts` in `test/integration/`): Test service interactions with real queue providers
- **E2E Tests** (`e2e.spec.ts`): End-to-end tests covering complete workflows

#### Environment Variables

You can customize test behavior with environment variables:

```bash
# Skip health checks (useful if services are started separately)
SKIP_HEALTH_CHECK=true npm run test:integration

# Custom SQS endpoint (default: http://localhost:4566)
AWS_ENDPOINT_URL=http://localhost:4566 npm run test:integration

# Custom RabbitMQ URL (default: amqp://guest:guest@localhost:5672)
RABBITMQ_URL=amqp://guest:guest@localhost:5672 npm run test:integration
```

## Architecture

The application uses Nest.js Dynamic Modules to allow swapping queue providers:

- **QueueService**: Main service that delegates to the configured provider
- **IQueueService**: Interface that all providers must implement
- **SqsProvider**: AWS SQS implementation
- **RabbitMqProvider**: RabbitMQ implementation
- **QueueModule**: Dynamic module that configures the appropriate provider based on environment variables
- **QueueGateway**: WebSocket gateway for all queue operations (publish, subscribe, unsubscribe, receive messages)

## Switching Queue Providers

To switch between queue providers, simply change the `QUEUE_PROVIDER` environment variable:

- `QUEUE_PROVIDER=sqs` - Use AWS SQS (or Localstack for local development)
- `QUEUE_PROVIDER=rabbitmq` - Use RabbitMQ

No code changes are required. The application will automatically use the configured provider.
