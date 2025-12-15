#!/usr/bin/env node
/**
 * Controller CLI - Runtime Wrapper
 * Thin CLI layer around ControllerClient library
 *
 * This is the "下駄" (runtime wrapper) for the library
 * Spec: docs/what-to-make.md Section 3.1 & 3.5
 */

import chalk from "chalk";
import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import { run as runConnect } from "./commands/connect.js";
import { run as runInteractive } from "./commands/interactive.js";
import { run as runList } from "./commands/list.js";
import { run as runScript } from "./commands/script.js";
import { run as runSend } from "./commands/send.js";

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("controller")
    .usage("Usage: $0 <command> [options]")
    .strict()
    .option("router", {
      type: "string",
      desc: "Router base URL (e.g., https://router.example.com)",
    })
    .option("cardhost", {
      type: "string",
      desc: "Target Cardhost UUID",
    })
    .option("token", {
      type: "string",
      desc: "Bearer token for Controller authentication",
    })
    .option("verbose", {
      type: "boolean",
      desc: "Enable verbose logging",
      default: false,
    })
    .command(
      "connect",
      "Establish authenticated connection to Router using Cardhost UUID",
      (y: Argv) =>
        y
          .option("router", { type: "string", desc: "Router address" })
          .option("cardhost", { type: "string", desc: "Cardhost UUID" })
          .option("verbose", {
            type: "boolean",
            desc: "Enable verbose logging",
          }),
      (argv) => runConnect(argv),
    )
    .command(
      "send",
      "Send a single APDU command (hex) to Cardhost via Router",
      (y: Argv) =>
        y.option("apdu", {
          type: "string",
          demandOption: true,
          desc: "APDU command hex string",
        }),
      (argv) => runSend(argv),
    )
    .command(
      "interactive",
      "Start REPL-like interactive mode for repeated APDU sends",
      (y: Argv) =>
        y
          .option("router", { type: "string", desc: "Router address" })
          .option("cardhost", { type: "string", desc: "Cardhost UUID" })
          .option("verbose", {
            type: "boolean",
            desc: "Enable verbose logging",
          }),
      (argv) => runInteractive(argv),
    )
    .command(
      "script",
      "Execute APDU commands from a JSON script file",
      (y: Argv) =>
        y.option("file", {
          type: "string",
          demandOption: true,
          desc: 'Path to JSON file containing [{"apdu":"HEX"}, ...]',
        }),
      (argv) => runScript(argv),
    )
    .command(
      "list",
      "List Cardhosts known to the Router",
      (y: Argv) =>
        y
          .option("router", { type: "string", desc: "Router address" })
          .option("verbose", {
            type: "boolean",
            desc: "Enable verbose logging",
          }),

      (argv) => runList(argv),
    )
    .help()
    .alias("h", "help")
    .version("0.1.0")
    .demandCommand(1, "Please specify a command")
    .parseAsync();
}

main().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
