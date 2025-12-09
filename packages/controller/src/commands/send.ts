import chalk from 'chalk';
import type { WebSocket } from 'ws';
import {
  logVerbose,
  parseApduHexOrThrow,
  establishSession,
  upgradeToWebSocket,
  prepareSessionKey,
  sendApduWithEncryption,
  type ControllerSession
} from '../lib.js';

export type SendCommandArgs = {
  router?: string;
  cardhost?: string;
  token?: string;
  apdu?: string;
  verbose?: boolean;
};

/**
 * Send command implementation extracted from CLI.
 * Refactor target: reduce size of CLI by delegating to modular command handlers.
 */
export async function run(argv: SendCommandArgs): Promise<void> {
  const { router, cardhost, token, apdu, verbose } = argv;

  if (!apdu) {
    // eslint-disable-next-line no-console
    console.error(chalk.red('Missing required option: --apdu "<HEX>"'));
    process.exitCode = 2;
    return;
  }

  if (!router || !cardhost || !token) {
    // eslint-disable-next-line no-console
    console.error(chalk.red('Missing required options: --router, --cardhost, --token'));
    process.exitCode = 2;
    return;
  }

  let apduBytes: Uint8Array;
  try {
    apduBytes = parseApduHexOrThrow(apdu);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(chalk.red((e as Error).message));
    process.exitCode = 2;
    return;
  }

  try {
    const session: ControllerSession = await establishSession(router, cardhost, token, verbose);
    await upgradeToWebSocket(router, session, verbose);

    await prepareSessionKey(session);

    logVerbose(verbose, 'Sending APDU:', apdu, 'bytes:', apduBytes);

    await sendApduWithEncryption(apdu, session, verbose);

    // Wait for response briefly
    await new Promise((resolve) => setTimeout(resolve, 1000));

    session.ws?.close();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Send failed: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}