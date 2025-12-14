import chalk from "chalk";
import { ControllerClient } from "../../core/controller-client.js";
import { KeyManager } from "../../core/key-manager.js";
import { NodeKeyStore } from "../store/node.js";

export type ConnectCommandArgs = {
  router?: string;
  cardhost?: string;
  verbose?: boolean;
};

/**
 * Connect command using new ControllerClient library
 * Establishes connection and keeps it alive
 */
export async function run(argv: ConnectCommandArgs): Promise<void> {
  const { router, cardhost, verbose } = argv;

  if (!router || !cardhost) {
    console.error(
      chalk.red("Missing required options: --router, --cardhost"),
    );
    process.exitCode = 2;
    return;
  }

  try {
    const keyStore = new NodeKeyStore();
    const keyManager = new KeyManager(keyStore);
    const client = new ControllerClient({
      routerUrl: router,
      cardhostUuid: cardhost,
      verbose,
      keyManager,
    });

    if (verbose) {
      console.info(chalk.gray("[verbose] Connecting to Router..."));
    }

    await client.connect(cardhost);

    console.info(chalk.green(`✓ Connected to Cardhost: ${cardhost}`));
    console.info(chalk.gray("Press Ctrl+C to disconnect"));

    // Keep process alive
    process.stdin.resume();

    // Cleanup on exit
    const cleanup = async () => {
      console.log("\nDisconnecting...");
      await client.disconnect();
      console.log("✓ Disconnected");
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch (error) {
    console.error(chalk.red(`Connection failed: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}
