/**
 * WebSocket Framework - Core Implementation
 *
 * Honoのようなfluent APIで、認証フェーズとRPCフェーズを分離管理
 */

import type { WebSocket } from "ws";
import type {
  WsContext,
  WsContextState,
  WsHandler,
  WsMiddleware,
  Message
} from "./types.js";
import { WsContextImpl } from "./context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ws-framework");

/**
 * WebSocket フレームワーク
 * 
 * 使用例:
 * ```typescript
 * const ws = new WsServer()
 *   .use(loggingMiddleware)
 *   .use(authenticationMiddleware)
 *   .onAuth(handleAuthPhase)
 *   .onRpc(handleRpcPhase);
 *
 * ws.on("connection", (socket) => {
 *   await ws.handle(socket);
 * });
 * ```
 */
export class WsServer<TGlobal extends WsContextState = WsContextState> {
  private middlewares: Array<WsMiddleware<any, any>> = [];
  private authHandler: WsHandler<TGlobal> | null = null;
  private rpcHandler: WsHandler<TGlobal & { authenticated: true }> | null = null;

  /**
   * グローバルミドルウェア追加
   * 認証・ログ・レート制限等を統一
   */
  use<TIn extends WsContextState, TOut extends WsContextState>(
    middleware: WsMiddleware<TIn, TOut>
  ): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 認証フェーズハンドラー設定
   */
  onAuth(handler: WsHandler<TGlobal>): this {
    this.authHandler = handler;
    return this;
  }

  /**
   * RPC フェーズハンドラー設定
   */
  onRpc(handler: WsHandler<TGlobal & { authenticated: true }>): this {
    this.rpcHandler = handler;
    return this;
  }

  /**
   * メインハンドラー - WebSocket接続時に呼び出し
   */
  async handle(ws: WebSocket): Promise<void> {
    const state: TGlobal = {} as TGlobal;
    const ctx = new WsContextImpl(ws, state);

    try {
      logger.debug("WebSocket connected");

      // ミドルウェアパイプライン実行
      await this.executeMiddlewarePipeline(ctx);

      // 認証フェーズ
      if (this.authHandler) {
        logger.debug("Entering auth phase");
        await this.authHandler(ctx);
      }

      // RPC フェーズ
      if (this.rpcHandler) {
        logger.debug("Entering RPC phase");
        await this.rpcHandler(ctx as any);
      }

      logger.debug("WebSocket session completed");
    } catch (error) {
      const err = error as Error;
      logger.error("WebSocket error", err);

      // エラー通知試行
      try {
        await ctx.sendError("INTERNAL_ERROR", err.message);
      } catch {}

      // 接続を閉じる
      try {
        await ctx.close(1011, "Internal error");
      } catch {}
    } finally {
      // クリーンアップ
      try {
        await ctx.close();
      } catch {}
    }
  }

  /**
   * ミドルウェアパイプライン実行
   */
  private async executeMiddlewarePipeline(ctx: WsContext): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index >= this.middlewares.length) {
        return;
      }

      const middleware = this.middlewares[index++];
      await middleware(ctx, next);
    };

    await next();
  }
}

/**
 * ミドルウェアファクトリー
 */
export const WsMiddlewares = {
  /**
   * ロギングミドルウェア
   */
  logging(): WsMiddleware {
    return async (ctx, next) => {
      const start = Date.now();
      logger.info("WS connection started");

      try {
        await next();
      } finally {
        const duration = Date.now() - start;
        logger.info("WS connection closed", { duration });
      }
    };
  },

  /**
   * レート制限ミドルウェア
   */
  rateLimit(maxMessages: number = 100, windowMs: number = 60000): WsMiddleware {
    return async (ctx, next) => {
      let messageCount = 0;
      const resetTimer = setInterval(() => {
        messageCount = 0;
      }, windowMs);

      const onMessage = () => {
        messageCount++;
        if (messageCount > maxMessages) {
          ctx.close(1008, "Rate limit exceeded").catch(() => {});
        }
      };

      ctx.ws.on("message", onMessage);

      try {
        await next();
      } finally {
        clearInterval(resetTimer);
        ctx.ws.off("message", onMessage);
      }
    };
  },

  /**
   * タイムアウトミドルウェア
   */
  timeout(ms: number = 30000): WsMiddleware {
    return async (ctx, next) => {
      const timer = setTimeout(() => {
        ctx.close(1000, "Session timeout").catch(() => {});
      }, ms);

      const onClose = () => {
        clearTimeout(timer);
      };

      ctx.ws.on("close", onClose);

      try {
        await next();
      } finally {
        clearTimeout(timer);
        ctx.ws.off("close", onClose);
      }
    };
  },

  /**
   * ハートビートミドルウェア
   */
  heartbeat(interval: number = 30000): WsMiddleware {
    return async (ctx, next) => {
      const timer = setInterval(() => {
        if (ctx.isOpen()) {
          ctx.send({ type: "ping" } as any).catch(() => {
            clearInterval(timer);
          });
        }
      }, interval);

      try {
        await next();
      } finally {
        clearInterval(timer);
      }
    };
  }
};
