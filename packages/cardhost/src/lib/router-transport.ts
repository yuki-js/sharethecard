/**
 * Router Transport for Cardhost
 * Implements ServerTransport interface from jsapdu-over-ip
 * Handles WebSocket communication with Router for RPC requests
 */

import { WebSocket } from "ws";
import type { ServerTransport } from "@aokiapp/jsapdu-over-ip";
import type {
  RpcRequest,
  RpcResponse,
  RpcEvent,
} from "@aokiapp/jsapdu-over-ip";

export interface RouterTransportConfig {
  routerUrl: string;
  cardhostUuid: string;
}

/**
 * WebSocket-based server transport for Cardhost
 * Connects to Router and handles jsapdu-over-ip RPC protocol
 */
export class RouterServerTransport implements ServerTransport {
  private ws: WebSocket | null = null;
  private requestHandler?: (request: RpcRequest) => Promise<RpcResponse>;
  private connected = false;

  constructor(private config: RouterTransportConfig) {}

  /**
   * Register RPC request handler
   */
  onRequest(handler: (request: RpcRequest) => Promise<RpcResponse>): void {
    this.requestHandler = handler;
  }

  /**
   * Send event to Router (which relays to Controller)
   */
  emitEvent(event: RpcEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const envelope = {
      type: "rpc-event",
      payload: event,
    };

    this.ws.send(JSON.stringify(envelope));
  }

  /**
   * Start transport (connect to Router via WebSocket)
   */
  async start(): Promise<void> {
    if (this.connected) {
      throw new Error("Transport already started");
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this.config.routerUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:")
        .replace(/\/$/, "");

      this.ws = new WebSocket(`${wsUrl}/api/jsapdu/ws`, {
        headers: {
          "x-role": "cardhost",
          "x-cardhost-uuid": this.config.cardhostUuid,
        },
      });

      this.ws.on("open", () => {
        this.connected = true;
        resolve();
      });

      this.ws.on("error", (err) => {
        if (!this.connected) {
          reject(err);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.ws = null;
      });

      this.ws.on("message", async (data) => {
        await this.handleMessage(data);
      });
    });
  }

  /**
   * Stop transport
   */
  async stop(): Promise<void> {
    if (!this.connected || !this.ws) {
      return;
    }

    return new Promise((resolve) => {
      this.ws!.once("close", () => {
        this.connected = false;
        this.ws = null;
        resolve();
      });

      this.ws!.close();
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(data: unknown): Promise<void> {
    try {
      const message = JSON.parse(
        data instanceof Buffer ? data.toString("utf8") : String(data),
      );

      // Handle RPC request
      if (message.type === "rpc-request" && this.requestHandler) {
        const request = message.payload as RpcRequest;
        const response = await this.requestHandler(request);

        // Send response back
        const responseEnvelope = {
          type: "rpc-response",
          payload: response,
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(responseEnvelope));
        }
      }
    } catch (error) {
      // Suppress console output in library code; allow higher layers to handle errors
    }
  }

  /**
   * Check if transport is connected
   */
  isConnected(): boolean {
    return (
      this.connected &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }
}
