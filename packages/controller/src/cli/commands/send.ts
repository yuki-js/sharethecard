import chalk from "chalk";

import { parseApduHex } from "../../core/hex.js";
import { ControllerClient, CommandApdu } from "../../core/index.js";
import { KeyManager } from "../../core/key-manager.js";
import { NodeKeyStore } from "../store/node.js";

export type SendCommandArgs = {
  router?: string;
  cardhost?: string;
  apdu?: string;
  verbose?: boolean;
};

/**
 * Send command using new ControllerClient library
 * Sends single APDU command and displays response
 */
export async function run(argv: SendCommandArgs): Promise<void> {
  const { router, cardhost, apdu, verbose } = argv;

  if (!apdu) {
    console.error(chalk.red('Missing required option: --apdu "<HEX>"'));
    process.exitCode = 2;
    return;
  }

  if (!router || !cardhost) {
    console.error(
      chalk.red("Missing required options: --router, --cardhost"),
    );
    process.exitCode = 2;
    return;
  }
  // Parse APDU hex string
  let bytes: Uint8Array;
  try {
    bytes = parseApduHex(apdu);
  } catch {
    console.error(
      chalk.red(
        "Invalid APDU hex format (must be even-length hex, at least 4 bytes)",
      ),
    );
    process.exitCode = 2;
    return;
  }

  try {
    const keyStore = new NodeKeyStore();
    const keyManager = new KeyManager(keyStore);
    await using client = new ControllerClient({
      routerUrl: router,
      cardhostUuid: cardhost,
      verbose,
      keyManager,
    });

    if (verbose) {
      console.info(chalk.gray("[verbose] Connecting..."));
    }

    await client.connect(cardhost);

    if (verbose) {
      console.info(chalk.gray(`[verbose] Sending APDU: ${apdu}`));
    }

    // Parse hex to CommandApdu (parsed earlier)

    const commandBytes = Uint8Array.from(bytes as unknown as Uint8Array);
    const command = CommandApdu.fromUint8Array(commandBytes as any);
    const response = await client.transmit(command);

    // Display response
    if (response.data.length > 0) {
      const dataHex = Array.from(response.data, (b) =>
        b.toString(16).padStart(2, "0"),
      )
        .join("")
        .toUpperCase();
      console.info(chalk.green(`Data: ${dataHex}`));
    }

    const sw = response.sw.toString(16).padStart(4, "0").toUpperCase();
    console.info(chalk.green(`SW: ${sw}`));

    // Cleanup handled by await using
  } catch (error) {
    console.error(chalk.red(`Send failed: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}
