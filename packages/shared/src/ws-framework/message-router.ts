/**
 * WebSocket Framework - Message Router
 *
 * メッセージタイプごとのハンドラーをマッピング
 */

import type { WsContext, WsContextState, Message, MessageHandler } from "./types.js";

/**
 * メッセージタイプごとのハンドラーをマッピングする
 * 
 * 使用例:
 * ```
 * const router = new MessageRouter()
 *   .register("auth-init", handleAuthInit)
 *   .register("auth-verify", handleAuthVerify)
 *   .register("error", handleError);
 *
 * ws.on("message", async (data) => {
 *   const msg = JSON.parse(data);
 *   await router.route(ctx, msg);
 * });
 * ```
 */
export class MessageRouter<T extends WsContextState = WsContextState> {
  private handlers = new Map<string, MessageHandler<T>>();
  private defaultHandler: MessageHandler<T> | null = null;

  /**
   * メッセージハンドラー登録
   */
  register(type: string, handler: MessageHandler<T>): this {
    this.handlers.set(type, handler);
    return this;
  }

  /**
   * デフォルトハンドラー設定（未登録メッセージ用）
   */
  setDefault(handler: MessageHandler<T>): this {
    this.defaultHandler = handler;
    return this;
  }

  /**
   * メッセージをルートしてハンドラー実行
   */
  async route(ctx: WsContext<T>, msg: Message): Promise<void> {
    const handler = this.handlers.get(msg.type);

    if (handler) {
      await handler(ctx, msg);
    } else if (this.defaultHandler) {
      await this.defaultHandler(ctx, msg);
    } else {
      // ハンドラーなし → エラー応答
      await ctx.sendError(
        "UNKNOWN_MESSAGE_TYPE",
        `Unknown message type: ${msg.type}`,
        msg.id
      );
    }
  }

  /**
   * メッセージハンドラー存在確認
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * ハンドラー一覧取得
   */
  getRegistered(): string[] {
    return Array.from(this.handlers.keys());
  }
}
