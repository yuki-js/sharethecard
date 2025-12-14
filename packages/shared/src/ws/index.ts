/**
 * Isomorphic WebSocket helpers (DRY)
 * - Works in both Browser (window.WebSocket) and Node (ws) without external deps
 * - Consolidates WsContextImpl and MessageRouter duplicated across controller/cardhost
 *
 * Usage:
 *   import { WsContextImpl, MessageRouter } from "@remote-apdu/shared";
 */

/**
 * Base envelope for message routing.
 */
export interface BaseMessage {
  type: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Minimal isomorphic WebSocket interface used by this module.
 * Compatible with browser WebSocket and node 'ws'.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: any, cb?: (err?: Error) => void): any;
  close(code?: number, reason?: string): any;

  // Node 'ws' style
  on?: (event: string, listener: (...args: any[]) => void) => any;
  once?: (event: string, listener: (...args: any[]) => void) => any;
  off?: (event: string, listener: (...args: any[]) => void) => any;

  // Browser style
  addEventListener?: (type: string, listener: (ev: any) => void) => any;
  removeEventListener?: (type: string, listener: (ev: any) => void) => any;
  onmessage?: any;
  onclose?: any;

  // Optional constants when present on constructor
  OPEN?: number;
  CLOSED?: number;
}

/**
 * Context state bag, extensible by callers.
 */
export type WsContextState = {
  [key: string]: unknown;
};

/**
 * Unified WebSocket context interface.
 */
export interface WsContext<T extends WsContextState = WsContextState> {
  ws: WebSocketLike;
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
 * Normalize incoming WebSocket data to UTF-8 string.
 */
function normalizeWsData(input: unknown): string {
  try {
    // Browser MessageEvent
    if (input && typeof (input as any).data !== "undefined") {
      const data = (input as any).data;
      if (typeof data === "string") return data;
      if (typeof (globalThis as any).Buffer !== "undefined" && data instanceof (globalThis as any).Buffer) {
        return (data as any).toString("utf8");
      }
      if (data instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(data));
      }
      return String(data);
    }

    // Node Buffer
    if (typeof (globalThis as any).Buffer !== "undefined" && input instanceof (globalThis as any).Buffer) {
      return (input as any).toString("utf8");
    }

    // ArrayBuffer
    if (input instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(input));
    }

    // Plain string or other
    if (typeof input === "string") return input;
    return String(input);
  } catch {
    return String(input ?? "");
  }
}

/**
 * Attach event listener in both Node and Browser environments
 */
function addWsListener(ws: WebSocketLike, event: "message" | "close", handler: (ev: any) => void): void {
  const anyWs = ws as any;
  if (typeof anyWs.on === "function") {
    anyWs.on(event, handler);
  } else if (typeof anyWs.addEventListener === "function") {
    anyWs.addEventListener(event, handler);
  } else {
    // Fallback: property assignment (browser)
    const prop = "on" + event;
    if (prop in anyWs) {
      anyWs[prop] = handler;
    }
  }
}

/**
 * Attach one-time listener for close events (both Node and Browser)
 */
function onceWsClose(ws: WebSocketLike, handler: () => void): void {
  const anyWs = ws as any;
  if (typeof anyWs.once === "function") {
    anyWs.once("close", handler);
    return;
  }
  const wrapped = () => {
    handler();
    if (typeof anyWs.removeEventListener === "function") {
      anyWs.removeEventListener("close", wrapped as any);
    } else {
      anyWs.onclose = null;
    }
  };
  if (typeof anyWs.addEventListener === "function") {
    anyWs.addEventListener("close", wrapped as any);
  } else {
    anyWs.onclose = wrapped;
  }
}

/**
 * WsContext implementation (isomorphic)
 */
export class WsContextImpl<T extends WsContextState = WsContextState> implements WsContext<T> {
  private pendingMessages = new Map<string, (msg: BaseMessage) => void>();
  private pendingIds = new Map<string, (msg: BaseMessage) => void>();
  private messageListenerAttached = false;
  private closed = false;

  constructor(
    public ws: WebSocketLike,
    public state: T,
  ) {
    this.attachMessageListener();
  }

  private attachMessageListener(): void {
    if (this.messageListenerAttached) return;

    addWsListener(this.ws, "message", (data: any) => {
      try {
        const text = normalizeWsData(data);
        const msg = JSON.parse(text) as BaseMessage;

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
    return new Promise((resolve, reject) => {
      try {
        const sendFn: any = (this.ws as any).send;
        if (typeof sendFn === "function") {
          // If node 'ws', callback form supported
          if (sendFn.length >= 2) {
            sendFn.call(this.ws, JSON.stringify(message), (err?: any) => {
              if (err) reject(err);
              else resolve();
            });
            return;
          }
          // Browser or generic
          sendFn.call(this.ws, JSON.stringify(message));
          resolve();
        } else {
          reject(new Error("WebSocket.send is not a function"));
        }
      } catch (err) {
        reject(err as Error);
      }
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
      const CLOSED = (this.ws as any).CLOSED ?? 3;
      if (this.ws.readyState === CLOSED) {
        resolve();
        return;
      }
      onceWsClose(this.ws, resolve);
      try {
        this.ws.close(code, reason);
      } catch {
        resolve();
      }
    });
  }

  isOpen(): boolean {
    const OPEN = (this.ws as any).OPEN ?? 1;
    return !this.closed && this.ws.readyState === OPEN;
  }
}

/**
 * Message handler signature
 */
export type MessageHandler<T extends WsContextState = WsContextState> = (
  ctx: WsContext<T>,
  msg: BaseMessage,
) => Promise<void>;

/**
 * Minimal message router keyed by message.type
 */
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
        (msg as any).id,
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