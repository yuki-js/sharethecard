/**
 * WebSocket Framework - WsContext Implementation
 *
 * 責務:
 * - WebSocket通信の抽象化
 * - 非同期メッセージ待機
 * - エラーハンドリング
 * - ライフサイクル管理
 */

import WebSocket from "ws";
import type { WsContext, WsContextState, Message } from "./types.js";

/**
 * WsContext実装
 */
export class WsContextImpl<
  T extends WsContextState = WsContextState,
> implements WsContext<T> {
  private pendingMessages = new Map<string, (msg: Message) => void>();
  private pendingIds = new Map<string, (msg: Message) => void>();
  private messageListenerAttached = false;
  private closed = false;

  constructor(
    public ws: WebSocket,
    public state: T,
  ) {
    this.attachMessageListener();
  }

  /**
   * メッセージリスナー設定（一度だけ）
   */
  private attachMessageListener(): void {
    if (this.messageListenerAttached) return;

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(
          data instanceof Buffer ? data.toString("utf8") : String(data),
        ) as Message;

        // id相関メッセージ処理
        if (msg.id) {
          const resolve = this.pendingIds.get(msg.id);
          if (resolve) {
            this.pendingIds.delete(msg.id);
            resolve(msg);
            return;
          }
        }

        // 型別メッセージ処理
        const typeResolve = this.pendingMessages.get(msg.type);
        if (typeResolve) {
          this.pendingMessages.delete(msg.type);
          typeResolve(msg);
        }
      } catch {
        // JSON パース失敗等、サイレント無視
      }
    });

    this.messageListenerAttached = true;
  }

  /**
   * メッセージ送信
   */
  async send(message: Message): Promise<void> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      new Error("WebSocket not open");
    }
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(message), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * エラーメッセージ送信
   */
  async sendError(code: string, message: string, id?: string): Promise<void> {
    await this.send({
      type: "error",
      id,
      error: { code, message },
    } as any);
  }

  /**
   * メッセージタイプ別待機
   * 例: await ctx.waitForMessage("auth-challenge")
   */
  async waitForMessage(type: string, timeout = 5000): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
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

  /**
   * メッセージID別待機
   * 例: await ctx.waitForId("rpc_12345")
   */
  async waitForId(id: string, timeout = 5000): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
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

  /**
   * 接続を閉じる
   */
  async close(code = 1000, reason = ""): Promise<void> {
    this.closed = true;
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      this.ws.once("close", resolve);
      this.ws.close(code, reason);
    });
  }

  /**
   * 接続状態確認
   */
  isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }
}
