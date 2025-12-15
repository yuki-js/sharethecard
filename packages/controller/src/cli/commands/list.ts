export type ListCommandArgs = {
  router?: string;
  verbose?: boolean;
};

/**
 * List command
 *
 * Displays list of available Cardhosts from Router
 * To connect to a Cardhost:
 * $ controller send --router <url> --cardhost <uuid> --apdu "..."
 */
export async function run(argv: ListCommandArgs): Promise<void> {
  void argv;
  // todo: implement list command
}
