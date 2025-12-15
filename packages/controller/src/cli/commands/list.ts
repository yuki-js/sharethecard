import chalk from "chalk";

export type ListCommandArgs = {
  router?: string;
  verbose?: boolean;
};

/**
 * List command - DEPRECATED
 * 
 * NOTE: The list command is no longer supported in the WebSocket-only architecture.
 * Each Controller connects directly to a specific Cardhost UUID, so listing is not necessary.
 * 
 * To connect to a Cardhost:
 * $ controller send --router <url> --cardhost <uuid> --apdu "..."
 */
export async function run(): Promise<void> {
  console.error(chalk.red("The 'list' command is no longer supported."));
  console.error(chalk.gray("In the WebSocket-only architecture, controllers connect directly to specific cardhosts."));
  console.error(chalk.gray("Provide the cardhost UUID when connecting."));
  process.exitCode = 1;
}
