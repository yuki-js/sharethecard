/**
 * Crypto Test Helpers
       * Shared cryptographic utilities for tests
       */
import { signChallenge as sharedSignChallenge } from "@remote-apdu/shared";
 
 export async function signChallenge(
   challenge: string,
   privateKeyBase64: string,
 ): Promise<string> {
   return await sharedSignChallenge(challenge, privateKeyBase64);
 }