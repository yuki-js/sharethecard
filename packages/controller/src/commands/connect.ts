import chalk from 'chalk';
import {
  logVerbose,
  establishSession,
  upgradeToWebSocket,
  type ControllerSession
} from '../lib.js';

export type ConnectCommandArgs = {
  router?: string;
  cardhost?: string;
  token?: string;
  verbose?: boolean;
};

/**
 * Connect command implementation extracted from CLI.
 * Establishes authenticated connection and upgrades to WebSocket.
 * Keeps the connection open (process stays alive) similar to original behavior.
 */
export async function run(argv: ConnectCommandArgs): Promise<void> {
  const { router, cardhost, token, verbose } = argv;

  if (!router || !cardhost || !token) {
    // eslint-disable-next-line no-console
    console.error(chalk.red('Missing required options: --router, --cardhost, --token'));
    process.exitCode = 2;
    return;
  }

  try {
    const session: ControllerSession = await establishSession(router, cardhost, token, verbose);
    await upgradeToWebSocket(router, session, verbose);

    // Wait a moment for session establishment
    await new Promise((resolve) => setTimeout(resolve, 500));

    // eslint-disable-next-line no-console
    console.info(chalk.green('Connected to Cardhost'));

    // Keep process alive while WebSocket is open
    // No explicit exit here to match original behavior
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Connection failed: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}