import ioClient from 'socket.io-client';
import { QueueMessage } from '../../../src/queue/interfaces/queue';

type ClientSocket = ReturnType<typeof ioClient>;

type SubscribeResponse = {
  queueName: string;
  message: string;
};

type UnsubscribeResponse = {
  queueName: string;
  message: string;
};

type PublishResponse = {
  queueName: string;
  message: string;
};

type QueueMessageEvent = {
  queueName: string;
  message: QueueMessage;
};

type QueueErrorEvent = {
  message: string;
  error?: string;
};

export interface SocketClientOptions {
  port?: number;
  namespace?: string;
  autoConnect?: boolean;
}

export class SocketClientHelper {
  private socket: ClientSocket | null = null;
  private readonly port: number;
  private readonly namespace: string;

  constructor(options: SocketClientOptions = {}) {
    this.port = options.port || 3000;
    this.namespace = options.namespace || '/';
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `http://localhost:${this.port}${this.namespace}`;
      this.socket = ioClient(url, {
        transports: ['websocket'],
        reconnection: false,
      });

      this.socket.on('connect', () => {
        resolve();
      });

      this.socket.on('connect_error', (error: Error) => {
        reject(error);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  subscribe(queueName: string): Promise<SubscribeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Subscribe timeout'));
      }, 5000);

      this.socket.once('queue:subscribed', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socket.once('queue:error', (error: Error) => {
        clearTimeout(timeout);
        reject(new Error(String(error)));
      });

      this.socket.emit('queue:subscribe', { queueName });
    });
  }

  unsubscribe(queueName: string): Promise<UnsubscribeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Unsubscribe timeout'));
      }, 5000);

      this.socket.once('queue:unsubscribed', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socket.once('queue:error', (error: Error) => {
        clearTimeout(timeout);
        reject(new Error(String(error)));
      });

      this.socket.emit('queue:unsubscribe', { queueName });
    });
  }

  publish(
    queueName: string,
    message: { body: string; attributes?: Record<string, string> },
  ): Promise<PublishResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Publish timeout'));
      }, 10000);

      this.socket.once('queue:published', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socket.once('queue:error', (error: Error) => {
        clearTimeout(timeout);
        reject(new Error(String(error)));
      });

      this.socket.emit('queue:publish', {
        queueName,
        message,
      });
    });
  }

  waitForMessage(timeoutMs = 10000): Promise<QueueMessageEvent> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Message wait timeout'));
      }, timeoutMs);

      this.socket.once('queue:message', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });
  }

  waitForError(timeoutMs: number = 5000): Promise<QueueErrorEvent> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Error wait timeout'));
      }, timeoutMs);

      this.socket.once('queue:error', (error) => {
        clearTimeout(timeout);
        resolve(error);
      });
    });
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getSocket(): ClientSocket | null {
    return this.socket;
  }
}
