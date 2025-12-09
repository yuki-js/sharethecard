import chalk from 'chalk';
import { fetch } from 'undici';
import { logVerbose } from '../lib.js';

export type ListCommandArgs = {
  router?: string;
  token?: string;
  verbose?: boolean;
};

/**
 * List command implementation extracted from CLI.
 * Fetches Cardhost list from Router with bearer authentication.
 */
export async function run(argv: ListCommandArgs): Promise<void> {
  const { router, token, verbose } = argv;

  if (!router || !token) {
    // eslint-disable-next-line no-console
    console.error(chalk.red('Missing required options: --router, --token'));
    process.exitCode = 2;
    return;
  }

  try {
    const res = await fetch(`${router.replace(/\/$/, '')}/cardhosts`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(chalk.red(`Failed to list cardhosts: ${res.status} ${res.statusText}`));
      process.exitCode = 1;
      return;
    }

    const data = (await res.json()) as Array<{ uuid: string; connected: boolean }>;
    logVerbose(verbose, 'Fetched cardhosts count:', data.length);

    // eslint-disable-next-line no-console
    console.info(chalk.green(`Cardhosts (${data.length}):`));

    for (const ch of data) {
      // eslint-disable-next-line no-console
      console.info(`- ${ch.uuid}  ${ch.connected ? chalk.green('online') : chalk.gray('offline')}`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Network error: ${(e as Error).message}`));
    process.exitCode = 1;
  }
}