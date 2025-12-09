import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { ControllerClient, CommandApdu } from '../lib/index.js';
import { parseApduHex } from '@remote-apdu/shared';

export type ScriptCommandArgs = {
  router?: string;
  cardhost?: string;
  token?: string;
  file?: string;
  verbose?: boolean;
};

/**
 * Script command using new ControllerClient library
 * Executes APDU commands from JSON file: [{ "apdu": "<HEX>" }, ...]
 */
export async function run(argv: ScriptCommandArgs): Promise<void> {
  const { file, router, cardhost, token, verbose } = argv;

  if (!file) {
    console.error(chalk.red('Missing required option: --file <path.json>'));
    process.exitCode = 2;
    return;
  }

  if (!router || !cardhost || !token) {
    console.error(chalk.red('Missing required options: --router, --cardhost, --token'));
    process.exitCode = 2;
    return;
  }

  // Read script file
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    console.error(chalk.red(`Failed to read file: ${(error as Error).message}`));
    process.exitCode = 2;
    return;
  }

  // Parse commands
  let commands: Array<{ apdu: string }>;
  try {
    commands = JSON.parse(content) as Array<{ apdu: string }>;
    if (!Array.isArray(commands)) {
      throw new Error('Script must be JSON array of {apdu: "HEX"} objects');
    }
  } catch (error) {
    console.error(chalk.red(`Invalid JSON: ${(error as Error).message}`));
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

    console.info(chalk.cyan(`Executing ${commands.length} commands from ${file}...`));
    console.info();

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      
      try {
        // Parse hex
        const bytes = parseApduHex(cmd.apdu);

        const commandBytes = Uint8Array.from(bytes as unknown as Uint8Array);
        const command = CommandApdu.fromUint8Array(commandBytes as any);

        if (verbose) {
          console.info(chalk.gray(`[verbose] [${i + 1}/${commands.length}] Sending: ${cmd.apdu}`));
        }

        const response = await client.transmit(command);

        // Display response
        const sw = response.sw.toString(16).padStart(4, '0').toUpperCase();
        console.info(chalk.green(`[${i + 1}] SW: ${sw}`));
        
        if (response.data.length > 0) {
          const dataHex = Array.from(response.data, b =>
            b.toString(16).padStart(2, '0')
          ).join('').toUpperCase();
          console.info(chalk.green(`    Data: ${dataHex}`));
        }

        successCount++;

      } catch (error) {
        console.error(chalk.red(`[${i + 1}] Failed: ${(error as Error).message}`));
        failCount++;
      }
    }

    console.info();
    console.info(chalk.green(`✓ Completed: ${successCount} success, ${failCount} failed`));

    // Cleanup handled by await using

  } catch (error) {
    console.error(chalk.red(`Script execution failed: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}