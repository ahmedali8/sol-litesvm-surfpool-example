import { randomBytes } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";

export const getRandomBigNumber = (size = 8): anchor.BN => {
  return new anchor.BN(randomBytes(size));
};
