/**
 * Abstract interface for a persistent, asynchronous key-value store.
 * This allows the KeyManager to be decoupled from the underlying storage mechanism
 * (e.g., Node.js filesystem, browser localStorage).
 */
export interface IKeyStore {
  /**
   * Saves a string value under a given key.
   * @param key The unique key for the data.
   * @param data The string data to save.
   * @returns A promise that resolves when the save operation is complete.
   */
  save(key: string, data: string): Promise<void>;

  /**
   * Loads a string value for a given key.
   * @param key The unique key for the data.
   * @returns A promise that resolves to the stored string, or null if the key is not found.
   */
  load(key: string): Promise<string | null>;

  /**
   * Checks for the existence of a key.
   * @param key The unique key to check.
   * @returns A promise that resolves to true if the key exists, false otherwise.
   */
  exists(key: string): Promise<boolean>;
}
