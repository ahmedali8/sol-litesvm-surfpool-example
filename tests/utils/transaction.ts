import { type Commitment, type Connection } from "@solana/web3.js";
import { getErrorFromRPCResponse } from "./logs";

export const confirmTransaction = async (
  connection: Connection,
  signature: string,
  commitment: Commitment = "confirmed",
): Promise<string> => {
  const block = await connection.getLatestBlockhash(commitment);
  const rpcResponse = await connection.confirmTransaction(
    {
      signature,
      ...block,
    },
    commitment,
  );

  getErrorFromRPCResponse(rpcResponse);

  return signature;
};
