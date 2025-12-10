// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const QUEUE_NAME = process.env.QUEUE_NAME || 'test-queue';

interface QueueMessage {
  id?: string;
  body: string;
  attributes?: Record<string, string>;
}

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] ${message}`,
    data ? JSON.stringify(data, null, 2) : '',
  );
}

async function testQueue() {
  log('🚀 Starting Queue API Test');
  log(`📡 Connecting to server: ${SERVER_URL}`);
  log(`📬 Using queue: ${QUEUE_NAME}`);

  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    reconnection: false,
  });

  return new Promise<void>((resolve, reject) => {
    let messageReceived = false;
    let publishConfirmed = false;
    let subscribeConfirmed = false;

    // Connection handlers
    socket.on('connect', () => {
      log('✅ Connected to WebSocket server', { socketId: socket.id });

      // Step 1: Subscribe to queue
      log('📝 Step 1: Subscribing to queue...');
      socket.emit('queue:subscribe', { queueName: QUEUE_NAME });
    });

    socket.on('connect_error', (error: Error) => {
      log('❌ Connection error:', error.message);
      log('💡 Make sure the server is running on', SERVER_URL);
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    socket.on('disconnect', (reason) => {
      log('🔌 Disconnected from server', { reason });
    });

    // Subscription handlers
    socket.on('queue:subscribed', (data) => {
      log('✅ Successfully subscribed to queue', data);
      subscribeConfirmed = true;

      // Step 2: Publish a test message
      setTimeout(() => {
        log('📤 Step 2: Publishing test message...');
        const testMessage: QueueMessage = {
          body: `Test message at ${new Date().toISOString()}`,
          attributes: {
            source: 'test-script',
            timestamp: Date.now().toString(),
          },
        };

        socket.emit('queue:publish', {
          queueName: QUEUE_NAME,
          message: testMessage,
        });
      }, 1000);
    });

    // Message handlers
    socket.on(
      'queue:message',
      (data: { queueName: string; message: QueueMessage }) => {
        log('📨 Step 3: Received message from queue!', {
          queueName: data.queueName,
          messageId: data.message.id,
          body: data.message.body,
          attributes: data.message.attributes,
        });
        messageReceived = true;

        // Step 4: Unsubscribe after receiving message
        setTimeout(() => {
          log('📝 Step 4: Unsubscribing from queue...');
          socket.emit('queue:unsubscribe', { queueName: QUEUE_NAME });
        }, 1000);
      },
    );

    socket.on('queue:published', (data) => {
      log('✅ Message published successfully', data);
      publishConfirmed = true;
    });

    socket.on('queue:unsubscribed', (data) => {
      log('✅ Successfully unsubscribed from queue', data);

      // Test complete - wait a bit then disconnect
      setTimeout(() => {
        log('🏁 Test completed! Disconnecting...');
        socket.disconnect();

        // Summary
        log('\n📊 Test Summary:');
        log(`  ✅ Connected: Yes`);
        log(`  ✅ Subscribed: ${subscribeConfirmed ? 'Yes' : 'No'}`);
        log(`  ✅ Published: ${publishConfirmed ? 'Yes' : 'No'}`);
        log(`  ✅ Message Received: ${messageReceived ? 'Yes' : 'No'}`);
        log(`  ✅ Unsubscribed: Yes`);

        if (subscribeConfirmed && publishConfirmed && messageReceived) {
          log('\n🎉 All tests passed!');
          resolve();
        } else {
          log('\n⚠️  Some tests failed');
          reject(new Error('Not all operations completed successfully'));
        }
      }, 1000);
    });

    // Error handlers
    socket.on('queue:error', (error) => {
      log('❌ Queue error occurred', error);
      reject(new Error(`Queue error: ${JSON.stringify(error)}`));
    });

    // Timeout safety
    setTimeout(() => {
      if (!messageReceived || !publishConfirmed || !subscribeConfirmed) {
        log('⏱️  Test timeout - some operations did not complete');
        socket.disconnect();
        reject(new Error('Test timeout'));
      }
    }, 30000); // 30 second timeout
  });
}

// Run the test
testQueue()
  .then(() => {
    log('✅ Test script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    log('❌ Test script failed', error.message);
    process.exit(1);
  });
