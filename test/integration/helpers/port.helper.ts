import * as net from 'net';

/**
 * Get an available port for testing
 * Uses port 0 to let the OS assign an available port
 * @returns Promise resolving to an available port number
 */
export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    // Use port 0 to let OS assign an available port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'string'
          ? parseInt(address.split(':').pop() || '0', 10)
          : address?.port || 0;

      server.close(() => {
        if (port === 0) {
          reject(new Error('Failed to get available port'));
        } else {
          resolve(port);
        }
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });
  });
}

/**
 * Get multiple available ports
 * @param count Number of ports needed
 * @returns Promise resolving to an array of available port numbers
 */
export async function getAvailablePorts(count: number): Promise<number[]> {
  const ports: number[] = [];

  for (let i = 0; i < count; i++) {
    const port = await getAvailablePort();
    ports.push(port);
  }

  return ports;
}
