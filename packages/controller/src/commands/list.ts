import chalk from "chalk";
import { ControllerClient } from "../lib/index.js";

export type ListCommandArgs = {
  router?: string;
  verbose?: boolean;
};

/**
 * List command implementation using new ControllerClient library
 * Lists available Cardhosts from Router
 *
 * NEW API (2025-12-09): No longer requires bearer token
 * Authentication via Ed25519 keypair stored in ~/.controller/
 */
export async function run(argv: ListCommandArgs): Promise<void> {
  const { router, verbose } = argv;

  if (!router) {
    console.error(chalk.red("Missing required option: --router"));
    process.exitCode = 2;
    return;
  }

  try {
    const client = new ControllerClient({
      routerUrl: router,
      verbose,
    });

    if (verbose) {
      console.info(chalk.gray("[verbose] Fetching Cardhost list..."));
    }

    const cardhosts = await client.listCardhosts();

    if (verbose) {
      console.info(
        chalk.gray(`[verbose] Fetched ${cardhosts.length} cardhosts`),
      );
    }

    console.info(chalk.green(`Cardhosts (${cardhosts.length}):`));

    for (const ch of cardhosts) {
      console.info(
        `- ${ch.uuid}  ${ch.connected ? chalk.green("online") : chalk.gray("offline")}`,
      );
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}
