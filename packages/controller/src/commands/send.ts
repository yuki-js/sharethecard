import chalk from 'chalk';
import { ControllerClient, CommandApdu } from '../lib/index.js';

export type SendCommandArgs = {
  router?: string;
  cardhost?: string;
  token?: string;
  apdu?: string;
  verbose?: boolean;
};

/**
 * Send command using new ControllerClient library
 * Sends single APDU command and displays response
 */
export async function run(argv: SendCommandArgs): Promise<void> {
  const { router, cardhost, token, apdu, verbose } = argv;

  if (!apdu) {
    console.error(chalk.red('Missing required option: --apdu "<HEX>"'));
    process.exitCode = 2;
    return;
  }

  if (!router || !cardhost || !token) {
    console.error(chalk.red('Missing required options: --router, --cardhost, --token'));
    process.exitCode = 2;
    return;
  }

  // Parse APDU hex string
  const cleaned = apdu.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned) || cleaned.length % 2 !== 0 || cleaned.length < 8) {
    console.error(chalk.red('Invalid APDU hex format (must be even-length hex, at least 4 bytes)'));
    process.exitCode = 2;
    return;
  }

  try {
    await using client = new ControllerClient({
      routerUrl: router,
      token,
      cardhostUuid: cardhost,
      verbose
    });

    if (verbose) {
      console.info(chalk.gray('[verbose] Connecting...'));
    }

    await client.connect(cardhost);

    if (verbose) {
      console.info(chalk.gray(`[verbose] Sending APDU: ${apdu}`));
    }

    // Parse hex to CommandApdu
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
    }

    const command = CommandApdu.fromUint8Array(bytes);
    const response = await client.transmit(command);

    // Display response
    if (response.data.length > 0) {
      const dataHex = Array.from(response.data, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      console.info(chalk.green(`Data: ${dataHex}`));
    }
    
    const sw = response.sw.toString(16).padStart(4, '0').toUpperCase();
    console.info(chalk.green(`SW: ${sw}`));

    // Cleanup handled by await using

  } catch (error) {
    console.error(chalk.red(`Send failed: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}