import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type Connection,
  type Keypair,
  type PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { makeKeypairs } from "./keypair";
import { confirmTransaction } from "./transaction";

export const createAccountsMintsAndTokenAccountsInstructions = async ({
  connection,
  lamports,
  payer,
  usersAndTokenBalances,
  decimals = 9,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
}: {
  connection: Connection;
  lamports: number;
  payer: Keypair;
  usersAndTokenBalances: Array<Array<number>>;
  decimals?: number;
  tokenProgram?: PublicKey;
}) => {
  const userCount = usersAndTokenBalances.length;

  // Set the variable mintCount to the largest array in the usersAndTokenBalances array
  const mintCount = Math.max(...usersAndTokenBalances.map((mintBalances) => mintBalances.length));

  const users = makeKeypairs(userCount);
  const mints = makeKeypairs(mintCount);

  // This will be returned
  // [user index][mint index]address of token account
  let tokenAccounts: Array<Array<PublicKey>>;

  tokenAccounts = users.map((user) => {
    return mints.map((mint) => getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, false, tokenProgram));
  });

  const sendSolInstructions: Array<TransactionInstruction> = users.map((user) =>
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      lamports,
      toPubkey: user.publicKey,
    }),
  );

  // Airdrops to user
  const minimumLamports = await getMinimumBalanceForRentExemptMint(connection);

  const createMintInstructions: Array<TransactionInstruction> = mints.map((mint) =>
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      lamports: minimumLamports,
      newAccountPubkey: mint.publicKey,
      programId: tokenProgram,
      space: MINT_SIZE,
    }),
  );

  // Make tokenA and tokenB mints, mint tokens and create ATAs
  const mintTokensInstructions: Array<TransactionInstruction> = usersAndTokenBalances.flatMap(
    (userTokenBalances, userIndex) => {
      return userTokenBalances.flatMap((tokenBalance, mintIndex) => {
        if (tokenBalance === 0) {
          return [];
        }
        return makeMintInstructions({
          amount: tokenBalance,
          ataAddress: tokenAccounts[userIndex][mintIndex],
          authority: users[userIndex].publicKey,
          decimals,
          mintAddress: mints[mintIndex].publicKey,
          payer: payer.publicKey,
          tokenProgram,
        });
      });
    },
  );

  const instructions = [...sendSolInstructions, ...createMintInstructions, ...mintTokensInstructions];

  const signers = [...users, ...mints, payer];

  return {
    instructions,
    mints,
    signers,
    tokenAccounts,
    users,
  };
};

export const makeMintInstructions = ({
  amount,
  ataAddress,
  authority,
  decimals,
  mintAddress,
  payer,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
}: {
  amount: number | bigint;
  ataAddress: PublicKey;
  authority: PublicKey;
  decimals: number;
  mintAddress: PublicKey;
  payer: PublicKey;
  tokenProgram?: PublicKey;
}): Array<TransactionInstruction> => {
  return [
    // Initializes a new mint and optionally deposits all the newly minted tokens in an account.
    createInitializeMint2Instruction(mintAddress, decimals, authority, null, tokenProgram),
    // Create the ATA
    createAssociatedTokenAccountIdempotentInstruction(payer, ataAddress, authority, mintAddress, tokenProgram),
    // Mint some tokens to the ATA
    createMintToInstruction(mintAddress, ataAddress, authority, amount, [], tokenProgram),
  ];
};

export const makeAndSendAndConfirmTransaction = async ({
  connection,
  instructions,
  signers,
  payer,
}: {
  connection: Connection;
  instructions: Array<TransactionInstruction>;
  signers: Array<Keypair>;
  payer: Keypair;
}) => {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    instructions,
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign(signers);

  const signature = await connection.sendTransaction(transaction);

  await confirmTransaction(connection, signature);
};
