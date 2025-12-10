import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, ValidationPipe, UsePipes, UseFilters } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueMessage } from './interfaces/queue';
import {
  SubscribeQueueDto,
  UnsubscribeQueueDto,
  PublishQueueDto,
} from './dtos';
import { WebSocketExceptionFilter } from './filters/websocket-exception.filter';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@UseFilters(new WebSocketExceptionFilter())
export class QueueGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(QueueGateway.name);
  private readonly clientSubscriptions = new Map<string, Set<string>>(); // clientId -> Set<queueName>
  private readonly queueHandlers = new Map<
    string,
    (message: QueueMessage) => Promise<void> | void
  >(); // queueName -> handler

  constructor(private readonly queueService: QueueService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.clientSubscriptions.set(client.id, new Set());
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const subscriptions = this.clientSubscriptions.get(client.id);
    if (subscriptions) {
      // Unsubscribe from all queues this client was subscribed to
      for (const queueName of subscriptions) {
        this.unsubscribeFromQueue(client, queueName);
      }
      this.clientSubscriptions.delete(client.id);
    }
  }

  @SubscribeMessage('queue:subscribe')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) => new WsException(errors),
    }),
  )
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SubscribeQueueDto,
  ) {
    const { queueName } = data;

    const subscriptions = this.clientSubscriptions.get(client.id);
    if (subscriptions?.has(queueName)) {
      client.emit('queue:subscribed', {
        queueName,
        message: 'Already subscribed to this queue',
      });
      return;
    }

    // If this is the first client subscribing to this queue, create the handler
    if (!this.queueHandlers.has(queueName)) {
      const handler = (message: QueueMessage): void => {
        // Deliver message to all clients subscribed to this queue
        const clients = Array.from(this.clientSubscriptions.entries())
          .filter(([, queues]) => queues.has(queueName))
          .map(([clientId]) => clientId);

        for (const clientId of clients) {
          const socket = this.server.sockets.sockets.get(clientId);
          if (socket) {
            socket.emit('queue:message', {
              queueName,
              message,
            });
          }
        }
      };

      this.queueHandlers.set(queueName, handler);

      // Subscribe to the queue with our handler
      await this.queueService.subscribe({
        queueName,
        handler,
      });

      this.logger.log(`Queue subscription created: ${queueName}`);
    }

    // Add this client to the subscription set
    if (!subscriptions) {
      this.clientSubscriptions.set(client.id, new Set([queueName]));
    } else {
      subscriptions.add(queueName);
    }

    client.emit('queue:subscribed', {
      queueName,
      message: 'Successfully subscribed to queue',
    });

    this.logger.log(`Client ${client.id} subscribed to queue: ${queueName}`);
  }

  @SubscribeMessage('queue:unsubscribe')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) => new WsException(errors),
    }),
  )
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UnsubscribeQueueDto,
  ) {
    const { queueName } = data;

    this.unsubscribeFromQueue(client, queueName);

    client.emit('queue:unsubscribed', {
      queueName,
      message: 'Successfully unsubscribed from queue',
    });
  }

  @SubscribeMessage('queue:publish')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) => new WsException(errors),
    }),
  )
  async handlePublish(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PublishQueueDto,
  ) {
    const { queueName, message } = data;

    await this.queueService.publish({
      queueName,
      message,
    });

    client.emit('queue:published', {
      queueName,
      message: 'Message published successfully',
    });
  }

  private unsubscribeFromQueue(client: Socket, queueName: string) {
    const subscriptions = this.clientSubscriptions.get(client.id);
    if (!subscriptions || !subscriptions.has(queueName)) {
      return;
    }

    subscriptions.delete(queueName);

    // If no more clients are subscribed to this queue, unsubscribe from the queue service
    const hasOtherSubscribers = Array.from(
      this.clientSubscriptions.values(),
    ).some((queues) => queues.has(queueName));

    if (!hasOtherSubscribers) {
      this.queueService
        .unsubscribe(queueName)
        .then(() => {
          this.queueHandlers.delete(queueName);
          this.logger.log(
            `Queue subscription removed (no more clients): ${queueName}`,
          );
        })
        .catch((error) => {
          this.logger.error(
            `Error unsubscribing from queue ${queueName}:`,
            error,
          );
        });
    }

    this.logger.log(
      `Client ${client.id} unsubscribed from queue: ${queueName}`,
    );
  }
}
