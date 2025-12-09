#!/usr/bin/env node
/**
 * Controller CLI
 * Refactor: delegate command implementations to modular handlers in src/commands/.
 * Spec: docs/what-to-make.md (Section 3.1)
 */

import yargs from 'yargs';
import type { Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

import { run as runConnect } from './commands/connect.js';
import { run as runSend } from './commands/send.js';
import { run as runInteractive } from './commands/interactive.js';
import { run as runScript } from './commands/script.js';
import { run as runList } from './commands/list.js';

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName('controller')
    .usage('Usage: $0 <command> [options]')
    .strict()
    .option('router', {
      type: 'string',
      desc: 'Router base URL (e.g., https://router.example.com)'
    })
    .option('cardhost', {
      type: 'string',
      desc: 'Target Cardhost UUID'
    })
    .option('token', {
      type: 'string',
      desc: 'Bearer token for Controller authentication'
    })
    .option('verbose', {
      type: 'boolean',
      desc: 'Enable verbose logging',
      default: false
    })
    .command(
      'connect',
      'Establish authenticated connection to Router using Cardhost UUID',
      (y: Argv) => y,
      (argv: unknown) => runConnect(argv as any)
    )
    .command(
      'send',
      'Send a single APDU command (hex) to Cardhost via Router',
      (y: Argv) =>
        y.option('apdu', {
          type: 'string',
          demandOption: true,
          desc: 'APDU command hex string'
        }),
      (argv: unknown) => runSend(argv as any)
    )
    .command(
      'interactive',
      'Start REPL-like interactive mode for repeated APDU sends',
      (y: Argv) => y,
      (argv: unknown) => runInteractive(argv as any)
    )
    .command(
      'script',
      'Execute APDU commands from a JSON script file',
      (y: Argv) =>
        y.option('file', {
          type: 'string',
          demandOption: true,
          desc: 'Path to JSON file containing [{"apdu":"HEX"}, ...]'
        }),
      (argv: unknown) => runScript(argv as any)
    )
    .command(
      'list',
      'List Cardhosts known to the Router',
      (y: Argv) => y,
      (argv: unknown) => runList(argv as any)
    )
    .help()
    .alias('h', 'help')
    .version('0.1.0')
    .demandCommand(1, 'Please specify a command')
    .parseAsync();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});