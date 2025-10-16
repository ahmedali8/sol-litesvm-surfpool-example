import { Keypair } from "@solana/web3.js";

export const makeKeypairs = (amount: number): Array<Keypair> => {
  return Array.from({ length: amount }, () => Keypair.generate());
};
