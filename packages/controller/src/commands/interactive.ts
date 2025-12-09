import chalk from 'chalk';
import { createInterface } from 'node:readline';
import {
  logVerbose,
  parseApduHexOrThrow,
  establishSession,
  upgradeToWebSocket,
  prepareSessionKey,
  sendApduWithEncryption,
  type ControllerSession
} from '../lib.js';

export type InteractiveCommandArgs = {
  router?: string;
  cardhost?: string;
  token?: string;
  verbose?: boolean;
};

/**
 * Interactive command implementation extracted from CLI.
 * Provides a REPL-like interface to send multiple APDU commands.
 */
export async function run(argv: InteractiveCommandArgs): Promise<void> {
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

    await prepareSessionKey(session);

    // eslint-disable-next-line no-console
    console.info(chalk.cyan('Interactive mode. Type "send <APDU_HEX>" or "exit".'));

    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const prompt = () => { rl.setPrompt('> '); rl.prompt(); };

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        rl.close();
        session.ws?.close();
        return;
      }

      if (trimmed.toLowerCase().startsWith('send ')) {
        const hex = trimmed.slice(5).trim();
        try {
          parseApduHexOrThrow(hex);
          logVerbose(verbose, 'Interactive send:', hex);
          await sendApduWithEncryption(hex, session, verbose);
          // Wait for response
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(chalk.red((e as Error).message));
        }
      } else {
        // eslint-disable-next-line no-console
        console.error(chalk.red('Unknown command. Use "send <APDU_HEX>" or "exit".'));
      }
      prompt();
    });

    rl.on('close', () => {
      // eslint-disable-next-line no-console
      console.info(chalk.green('Interactive session ended.'));
      session.ws?.close();
      process.exit(0);
    });

    prompt();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Interactive mode failed: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}