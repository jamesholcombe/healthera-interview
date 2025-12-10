// Suppress console errors and warnings during unit tests
// This prevents expected errors from cluttering test output
// Note: NestJS Logger writes directly to stderr, so we also suppress process.stderr.write

const originalError = console.error;
const originalWarn = console.warn;
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Store original implementations
const suppressedErrorPatterns = [
  'Error unsubscribing',
  'Queue creation error',
  'Queue publish error',
  'Queue subscribe error',
  'Queue error',
  'Queue not found',
];

const suppressedWarnPatterns = [
  'WebSocket validation error',
  'Queue not found',
  'WebSocket error',
];

// Suppress console.error
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

// Suppress console.warn
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

// Suppress process.stderr.write (used by NestJS Logger)
// Using any for chunk because it can be string, Buffer, or Uint8Array
// Using any for encoding and cb because Node.js types are complex and Jest mocks need flexibility

process.stderr.write = jest.fn(
  (
    chunk: any,
    encoding?: BufferEncoding,
    cb?: (error?: Error | null) => void,
  ) => {
    const message = chunk?.toString() || '';

    const shouldSuppress = [
      ...suppressedErrorPatterns,
      ...suppressedWarnPatterns,
    ].some((pattern) => message.includes(pattern));

    if (!shouldSuppress && originalStderrWrite) {
      return originalStderrWrite.call(process.stderr, chunk, encoding, cb);
    }
    return true;
  },
) as typeof process.stderr.write;
