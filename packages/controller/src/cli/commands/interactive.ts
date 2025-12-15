import { createInterface } from "node:readline";

import chalk from "chalk";

import { parseApduHex } from "../../core/hex.js";
import { ControllerClient, CommandApdu } from "../../core/index.js";
import { KeyManager } from "../../core/key-manager.js";
import { NodeKeyStore } from "../store/node.js";

export type InteractiveCommandArgs = {
  router?: string;
  cardhost?: string;
  verbose?: boolean;
};

/**
 * Interactive command using new ControllerClient library
 * Provides REPL-like interface for multiple APDU commands
 */
export async function run(argv: InteractiveCommandArgs): Promise<void> {
  const { router, cardhost, verbose } = argv;

  if (!router || !cardhost) {
    console.error(chalk.red("Missing required options: --router, --cardhost"));
    process.exitCode = 2;
    return;
  }

  const keyStore = new NodeKeyStore();
  const keyManager = new KeyManager(keyStore);
  const client = new ControllerClient({
    routerUrl: router,
    cardhostUuid: cardhost,
    verbose,
    keyManager,
  });

  try {
    if (verbose) {
      console.info(chalk.gray("[verbose] Connecting..."));
    }

    await client.connect(cardhost);

    console.info(chalk.cyan("Interactive mode. Commands:"));
    console.info(chalk.cyan("  send <APDU_HEX>  - Send APDU command"));
    console.info(chalk.cyan("  exit, quit       - Exit interactive mode"));
    console.info();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const prompt = () => {
      rl.setPrompt("> ");
      rl.prompt();
    };

    rl.on("line", async (line) => {
      const trimmed = line.trim();

      if (
        trimmed.toLowerCase() === "exit" ||
        trimmed.toLowerCase() === "quit"
      ) {
        rl.close();
        return;
      }

      if (trimmed.toLowerCase().startsWith("send ")) {
        const hex = trimmed.slice(5).trim();
        try {
          // Parse hex string
          const bytes = parseApduHex(hex);
          const command = CommandApdu.fromUint8Array(bytes);

          if (verbose) {
            console.info(chalk.gray(`[verbose] Sending: ${hex}`));
          }

          const response = await client.transmit(command);

          // Display response
          if (response.data.length > 0) {
            const dataHex = Array.from(response.data, (b: number) =>
              b.toString(16).padStart(2, "0"),
            )
              .join("")
              .toUpperCase();
            console.info(chalk.green(`< Data: ${dataHex}`));
          }

          const sw = response.sw.toString(16).padStart(4, "0").toUpperCase();
          console.info(chalk.green(`< SW: ${sw}`));
        } catch (error) {
          console.error(chalk.red(`Error: ${(error as Error).message}`));
        }
      } else if (trimmed.length > 0) {
        console.error(
          chalk.red('Unknown command. Use "send <APDU_HEX>" or "exit".'),
        );
      }

      prompt();
    });

    rl.on("close", async () => {
      console.info(chalk.green("\nInteractive session ended."));
      await client.disconnect();
      process.exit(0);
    });

    prompt();
  } catch (error) {
    console.error(
      chalk.red(`Interactive mode failed: ${(error as Error).message}`),
    );
    await client.disconnect().catch(() => {});
    process.exitCode = 1;
  }
}
