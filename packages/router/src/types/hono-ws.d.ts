// Ambient module declaration to satisfy TypeScript when using 'hono/ws' in NodeNext mode.
// Hono v4 provides an 'upgradeWebSocket' runtime helper; typings may differ across versions.
declare module 'hono/ws' {
  // Minimal fallback typing to unblock compilation; refine if upstream types are available.
  export function upgradeWebSocket(handler: (c: any) => {
    onOpen?: (ws: any) => void;
    onMessage?: (ws: any, message: any) => void;
    onClose?: (ws: any) => void;
    onError?: (ws: any, err: any) => void;
  }): any;

  // Provide the type name suggested by TS hint to avoid "did you mean 'UpgradeWebSocket'?"
  export type UpgradeWebSocket = typeof upgradeWebSocket;
}