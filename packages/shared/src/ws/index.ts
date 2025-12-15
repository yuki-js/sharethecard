/**
 * Isomorphic WebSocket helpers (DRY)
 * - Works in both Browser and Node via isomorphic-ws
 * - Consolidates WsContextImpl and MessageRouter duplicated across controller/cardhost
 *
 * Usage:
 *   import { WsContextImpl, MessageRouter } from "@remote-apdu/shared";
 */

import WebSocket from "isomorphic-ws";

/**
 * Base envelope for message routing.
 */
export interface BaseMessage {
  type: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Context state bag, extensible by callers.
 */
export type WsContextState = {
  [key: string]: unknown;
};

/**
 * Unified WebSocket context interface (isomorphic-ws instance).
 * Exposes no raw socket; the underlying WebSocket is internal to the context.
 */
export interface WsContext<T extends WsContextState = WsContextState> {
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
 * Normalize incoming WebSocket data to UTF-8 string (minimal).
 * - Prefer event.data if present, otherwise use input directly.
 * - Decode ArrayBuffer or ArrayBufferView via TextDecoder.
 * - Fallback to String() for non-binary payloads.
 */
function normalizeWsData(input: unknown): string {
  const candidate =
    input && typeof input === "object" && "data" in (input as any)
      ? (input as any).data
      : input;

  if (typeof candidate === "string") return candidate;

  if (candidate instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(candidate));
  }

  if (ArrayBuffer.isView(candidate)) {
    const view = candidate as ArrayBufferView;
    return new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }

  return String(candidate);
}

/**
 * Runtime validator for BaseMessage without using 'as'.
 * Ensures 'type' is string and optional 'id' is string when present.
 */
function isBaseMessage(value: unknown): value is BaseMessage {
  if (typeof value !== "object" || value === null) return false;
  const typeVal = Reflect.get(value, "type");
  if (typeof typeVal !== "string") return false;
  const idVal = Reflect.get(value, "id");
  if (idVal !== undefined && typeof idVal !== "string") return false;
  return true;
}

/**
 * WsContext implementation (isomorphic)
 */
export class WsContextImpl<T extends WsContextState = WsContextState>
  implements WsContext<T>
{
  private socket: WebSocket;
  private pendingMessages = new Map<string, (msg: BaseMessage) => void>();
  private pendingIds = new Map<string, (msg: BaseMessage) => void>();
  private messageListenerAttached = false;
  private closed = false;

  constructor(socket: WebSocket, public state: T) {
    this.socket = socket;
    this.attachMessageListener();
  }

  private attachMessageListener(): void {
    if (this.messageListenerAttached) return;

    this.socket.addEventListener("message", (event: unknown) => {
      try {
        const text = normalizeWsData(event);
        const raw: unknown = JSON.parse(text);
        if (!isBaseMessage(raw)) {
          // Ignore messages that don't conform to BaseMessage
          return;
        }
        const msg = raw;

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
        const data = JSON.stringify(message);
        this.socket.send(data);
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async sendError(code: string, message: string, id?: string): Promise<void> {
    await this.send({
      type: "error",
      id,
      error: { code, message },
    });
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
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      const onClose = () => {
        try {
          this.socket.removeEventListener("close", onClose as any);
        } catch {
          // ignore if not supported
        }
        resolve();
      };
      this.socket.addEventListener("close", onClose as any);
      try {
        this.socket.close(code, reason);
      } catch {
        resolve();
      }
    });
  }

  isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
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