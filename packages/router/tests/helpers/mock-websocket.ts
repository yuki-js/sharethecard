/**
 * Mock WebSocket for Testing
 * Simulates WebSocket behavior without actual network connection
 */

import { EventEmitter } from "node:events";

export class MockWebSocket extends EventEmitter {
  public sentMessages: unknown[] = [];
  public closed = false;
  public closeCode?: number;
  public closeReason?: string;

  send(data: unknown): void {
    if (this.closed) {
      throw new Error("WebSocket is closed");
    }
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit("close");
  }

  /**
   * Simulate receiving message from remote
   */
  receive(data: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(data)));
  }

  /**
   * Get last sent message
   */
  getLastMessage(): unknown {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  /**
   * Clear sent messages history
   */
  clearMessages(): void {
    this.sentMessages = [];
  }
}