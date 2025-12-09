/**
 * WebSocket Framework - Message Protocol Types
 *
 * すべてのメッセージ型定義
 * 認証、RPC、エラー、制御メッセージを統一的に定義
 */

import type { WebSocket } from "ws";

/**
 * すべてのWebSocketメッセージの基底型
 * - type フィールドでメッセージを分類
 * - id フィールドでrequest/response相関（オプション）
 */
export interface BaseMessage {
  type: string;
  id?: string;
}

// ========== 認証メッセージ ==========

export interface AuthInitMessage extends BaseMessage {
  type: "auth-init";
  publicKey: string;  // Ed25519 public key (SPKI, base64)
}

export interface AuthChallengeMessage extends BaseMessage {
  type: "auth-challenge";
  uuid?: string;      // Cardhost: UUID
  controllerId?: string;  // Controller: ID
  challenge: string;  // Random nonce (base64)
}

export interface AuthVerifyMessage extends BaseMessage {
  type: "auth-verify";
  signature: string;  // Ed25519 signature (base64)
}

export interface AuthSuccessMessage extends BaseMessage {
  type: "auth-success";
  uuid?: string;          // Cardhost
  controllerId?: string;  // Controller
}

// ========== Controller接続メッセージ ==========

export interface ConnectCardhostMessage extends BaseMessage {
  type: "connect-cardhost";
  cardhostUuid: string;
}

export interface ConnectedMessage extends BaseMessage {
  type: "connected";
  cardhostUuid: string;
}

// ========== RPC メッセージ ==========

export interface RpcRequestMessage extends BaseMessage {
  type: "rpc-request";
  id: string;  // 必須（相関用）
  payload: unknown;
}

export interface RpcResponseMessage extends BaseMessage {
  type: "rpc-response";
  id: string;  // 必須（相関用）
  payload: unknown;
}

export interface RpcEventMessage extends BaseMessage {
  type: "rpc-event";
  payload: unknown;
}

// ========== エラーメッセージ ==========

export interface ErrorMessage extends BaseMessage {
  type: "error";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ========== 制御メッセージ ==========

export interface PingMessage extends BaseMessage {
  type: "ping";
}

export interface PongMessage extends BaseMessage {
  type: "pong";
}

// ========== ユニオン型 ==========

export type Message =
  | AuthInitMessage
  | AuthChallengeMessage
  | AuthVerifyMessage
  | AuthSuccessMessage
  | ConnectCardhostMessage
  | ConnectedMessage
  | RpcRequestMessage
  | RpcResponseMessage
  | RpcEventMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

/**
 * WsContext の状態型
 */
export interface WsContextState {
  authenticated?: boolean;
  uuid?: string;          // Cardhost
  controllerId?: string;  // Controller
  cardhostUuid?: string;  // Controller（接続中）
  phase?: "auth" | "connected" | "rpc";
  [key: string]: unknown;
}

/**
 * WsContext - メッセージ処理のための実行コンテキスト
 */
export interface WsContext<T extends WsContextState = WsContextState> {
  ws: WebSocket;
  state: T;

  // メッセージ送信
  send(message: Message): Promise<void>;
  sendError(code: string, message: string, id?: string): Promise<void>;

  // 応答待機
  waitForMessage(type: string, timeout?: number): Promise<Message>;
  waitForId(id: string, timeout?: number): Promise<Message>;

  // 接続管理
  close(code?: number, reason?: string): Promise<void>;

  // ヘルパー
  isOpen(): boolean;
}

/**
 * ハンドラー型定義
 */
export type WsHandler<T extends WsContextState = WsContextState> = (
  ctx: WsContext<T>
) => Promise<void>;

export type MessageHandler<T extends WsContextState = WsContextState> = (
  ctx: WsContext<T>,
  msg: Message
) => Promise<void>;

/**
 * ミドルウェア型定義
 */
export type WsMiddleware<
  TIn extends WsContextState = WsContextState,
  TOut extends WsContextState = TIn
> = (
  ctx: WsContext<TIn>,
  next: () => Promise<void>
) => Promise<void>;
