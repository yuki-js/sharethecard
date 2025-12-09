/**
 * Router Transport for Controller
 * Implements ClientTransport interface from jsapdu-over-ip
 * Handles HTTP/WebSocket communication with Router for RPC calls
 *
 * Reference: research/jsapdu-over-ip/src/transport.ts - FetchClientTransport
 */

import type { ClientTransport } from "@aokiapp/jsapdu-over-ip";
import type {
  RpcRequest,
  RpcResponse,
  RpcEvent,
} from "@aokiapp/jsapdu-over-ip";
import { fetch } from "undici";

export interface RouterClientTransportConfig {
  rpcEndpoint: string;
  sessionToken: string; // Session ID identifies the Controller-Cardhost connection
  controllerId: string; // Router-derived Controller ID
}

/**
 * HTTP-based client transport for Controller
 * Sends RPC requests to Router which forwards to Cardhost via session
 *
 * SECURITY (2025-12-09):
 * - Uses x-controller-id for authentication
 * - Uses x-session-token for routing (identifies which Cardhost)
 * - NO x-cardhost-uuid: Session already identifies the target Cardhost
 */
export class RouterClientTransport implements ClientTransport {
  private eventCallbacks: Set<(event: RpcEvent) => void> = new Set();

  constructor(private config: RouterClientTransportConfig) {}

  /**
   * Call RPC method via HTTP POST
   *
   * SECURITY: Session token identifies the target Cardhost
   * No need to send Cardhost UUID separately
   */
  async call(request: RpcRequest): Promise<RpcResponse> {
    const response = await fetch(this.config.rpcEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-controller-id": this.config.controllerId,
        "x-session-token": this.config.sessionToken,
        // NO x-cardhost-uuid: Session token already identifies the target
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `RPC call failed: ${response.status} ${response.statusText}`,
      );
    }

    const result = (await response.json()) as unknown;

    // Validate RpcResponse structure
    if (!this.isRpcResponse(result)) {
      throw new Error("Invalid RpcResponse format from server");
    }

    return result;
  }

  /**
   * Register event listener (optional)
   */
  onEvent(callback: (event: RpcEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Close transport (optional)
   */
  async close(): Promise<void> {
    this.eventCallbacks.clear();
  }

  /**
   * Type guard for RpcResponse
   */
  private isRpcResponse(obj: unknown): obj is RpcResponse {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "id" in obj &&
      typeof (obj as RpcResponse).id === "string" &&
      ("result" in obj || "error" in obj) &&
      (!("error" in obj) ||
        (typeof (obj as RpcResponse).error?.code === "string" &&
          typeof (obj as RpcResponse).error?.message === "string"))
    );
  }

  /**
   * Update configuration (for reconnection scenarios)
   */
  updateConfig(config: Partial<RouterClientTransportConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
