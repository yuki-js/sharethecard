/**
 * Minimal Node-only WebSocket helpers for Cardhost
 * - Environment-agnostic types remain in @remote-apdu/shared
 * - Node-specific runtime (ws) lives in the Cardhost package
 */

import type { WebSocket } from "ws";

/**
 * Base envelope for message routing.
 * Keep it permissive to avoid coupling to shared message union.
 */
export interface BaseMessage {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export type WsContextState = {
  [key: string]: unknown;
};

export interface WsContext<T extends WsContextState = WsContextState> {
  ws: WebSocket;
  state: T;

  // Messaging
  send(message: BaseMessage): Promise<void>;
  sendError(code: string, message: string, id?: string): Promise<void>;

  // Await helpers
  waitForMessage(type: string, timeout?: number): Promise<BaseMessage>;
  waitForId(id: string, timeout?: number): Promise<BaseMessage>;

  // Connection mgmt
  close(code?: number, reason?: string): Promise<void>;
  isOpen(): boolean;
}

/**
 * WsContext implementation for Node 'ws'
 */
export class WsContextImpl<T extends WsContextState = WsContextState>
  implements WsContext<T>
{
  private pendingMessages = new Map<string, (msg: BaseMessage) => void>();
  private pendingIds = new Map<string, (msg: BaseMessage) => void>();
  private messageListenerAttached = false;
  private closed = false;

  constructor(
    public ws: WebSocket,
    public state: T,
  ) {
    this.attachMessageListener();
  }

  private attachMessageListener(): void {
    if (this.messageListenerAttached) return;

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(
          data instanceof Buffer ? data.toString("utf8") : String(data),
        ) as BaseMessage;

        // id-correlated messages
        if (msg.id) {
          const resolve = this.pendingIds.get(msg.id);
          if (resolve) {
            this.pendingIds.delete(msg.id);
            resolve(msg);
            return;
          }
        }

        // type-correlated messages
        const typeResolve = this.pendingMessages.get(msg.type);
        if (typeResolve) {
          this.pendingMessages.delete(msg.type);
          typeResolve(msg);
        }
      } catch {
        // ignore JSON parse errors silently
      }
    });

    this.messageListenerAttached = true;
  }

  async send(message: BaseMessage): Promise<void> {
    if (this.closed || this.ws.readyState !== (this.ws.constructor as any).OPEN) {
      // Do not throw synchronously; let ws callback handle async error
    }
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(message), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async sendError(code: string, message: string, id?: string): Promise<void> {
    await this.send({
      type: "error",
      id,
      error: { code, message },
    } as BaseMessage);
  }

  async waitForMessage(type: string, timeout = 5000): Promise<BaseMessage> {
    return new Promise<BaseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMessages.delete(type);
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeout);

      this.pendingMessages.set(type, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async waitForId(id: string, timeout = 5000): Promise<BaseMessage> {
    return new Promise<BaseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIds.delete(id);
        reject(new Error(`Timeout waiting for message ID: ${id}`));
      }, timeout);

      this.pendingIds.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async close(code = 1000, reason = ""): Promise<void> {
    this.closed = true;
    return new Promise((resolve) => {
      const CLOSED = (this.ws.constructor as any).CLOSED ?? 3; // compat: ws.CLOSED === 3
      if (this.ws.readyState === CLOSED) {
        resolve();
        return;
      }

      this.ws.once("close", resolve);
      try {
        this.ws.close(code, reason);
      } catch {
        resolve();
      }
    });
  }

  isOpen(): boolean {
    const OPEN = (this.ws.constructor as any).OPEN ?? 1; // compat: ws.OPEN === 1
    return !this.closed && this.ws.readyState === OPEN;
  }
}

/**
 * Minimal message router keyed by message.type
 */
export type MessageHandler<T extends WsContextState = WsContextState> = (
  ctx: WsContext<T>,
  msg: BaseMessage,
) => Promise<void>;

export class MessageRouter<T extends WsContextState = WsContextState> {
  private handlers = new Map<string, MessageHandler<T>>();
  private defaultHandler: MessageHandler<T> | null = null;

  register(type: string, handler: MessageHandler<T>): this {
    this.handlers.set(type, handler);
    return this;
  }

  setDefault(handler: MessageHandler<T>): this {
    this.defaultHandler = handler;
    return this;
  }

  async route(ctx: WsContext<T>, msg: BaseMessage): Promise<void> {
    const handler = this.handlers.get(msg.type);
    if (handler) {
      await handler(ctx, msg);
    } else if (this.defaultHandler) {
      await this.defaultHandler(ctx, msg);
    } else {
      await ctx.sendError(
        "UNKNOWN_MESSAGE_TYPE",
        `Unknown message type: ${msg.type}`,
        msg.id,
      );
    }
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  getRegistered(): string[] {
    return Array.from(this.handlers.keys());
  }
}