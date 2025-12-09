import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import {
  logVerbose,
  parseApduHexOrThrow,
  establishSession,
  upgradeToWebSocket,
  prepareSessionKey,
  sendApduWithEncryption,
  type ControllerSession
} from '../lib.js';

export type ScriptCommandArgs = {
  router?: string;
  cardhost?: string;
  token?: string;
  file?: string;
  verbose?: boolean;
};

/**
 * Script command implementation extracted from CLI.
 * Executes APDU commands from a JSON script file: [{ "apdu": "<HEX>" }, ...]
 */
export async function run(argv: ScriptCommandArgs): Promise<void> {
  const { file, router, cardhost, token, verbose } = argv;

  if (!file) {
    // eslint-disable-next-line no-console
    console.error(chalk.red('Missing required option: --file <path.json>'));
    process.exitCode = 2;
    return;
  }

  if (!router || !cardhost || !token) {
    // eslint-disable-next-line no-console
    console.error(chalk.red('Missing required options: --router, --cardhost, --token'));
    process.exitCode = 2;
    return;
  }

  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Failed to read file: ${(e as Error).message}`));
    process.exitCode = 2;
    return;
  }

  try {
    const commands = JSON.parse(content) as Array<{ apdu: string }>;

    const session: ControllerSession = await establishSession(router, cardhost, token, verbose);
    await upgradeToWebSocket(router, session, verbose);

    await prepareSessionKey(session);

    for (const cmd of commands) {
      try {
        parseApduHexOrThrow(cmd.apdu);
        logVerbose(verbose, 'Script sending:', cmd.apdu);
        await sendApduWithEncryption(cmd.apdu, session, verbose);
        // small delay to allow response processing
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(chalk.red(`Command failed: ${(e as Error).message}`));
      }
    }

    session.ws?.close();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Script execution failed: ${(e as Error).message}`));
    process.exitCode = 1;
  }
}