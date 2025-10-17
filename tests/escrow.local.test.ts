import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  type TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { type Escrow } from "../target/types/escrow";
import { getRandomBigNumber } from "./utils/random-bn";
import { createAccountsMintsAndTokenAccountsInstructions, makeAndSendAndConfirmTransaction } from "./utils/token";
import { confirmTransaction } from "./utils/transaction";

// Work on both Token Program and new Token Extensions Program
const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

const SECONDS = 1000;

// Tests must complete within half this time otherwise
// they are marked as slow. Since Anchor involves a little
// network IO, these tests usually take about 15 seconds.
const ANCHOR_SLOW_TEST_THRESHOLD = 40 * SECONDS;

describe("escrow", () => {
  // We're going to reuse these accounts across multiple tests
  const accounts: Record<string, PublicKey> = {
    tokenProgram: TOKEN_PROGRAM,
  };

  let provider: anchor.AnchorProvider;
  let program: anchor.Program<Escrow>;

  let payer: Keypair;
  let alice: Keypair;
  let bob: Keypair;
  let tokenMintA: Keypair;
  let tokenMintB: Keypair;

  const tokenAOfferedAmount = new anchor.BN(1_000_000);
  const tokenBWantedAmount = new anchor.BN(1_000_000);

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.Escrow;

    payer = provider.wallet.payer;

    // Create Alice and Bob accounts, 2 token mints, and associated token accounts for both tokens for both users
    const usersMintsAndTokenAccounts = await createAccountsMintsAndTokenAccountsInstructions({
      connection: provider.connection,
      decimals: 6,
      lamports: 1 * LAMPORTS_PER_SOL,
      payer,
      usersAndTokenBalances: [
        // Alice's token balances
        [
          // 1_000_000_000 of token A
          1_000_000_000,
          // 0 of token B
          0,
        ],
        // Bob's token balances
        [
          // 0 of token A
          0,
          // 1_000_000_000 of token B
          1_000_000_000,
        ],
      ],
    });
    await makeAndSendAndConfirmTransaction({
      connection: provider.connection,
      instructions: usersMintsAndTokenAccounts.instructions,
      payer,
      signers: usersMintsAndTokenAccounts.signers,
    });

    // Alice will be the maker (creator) of the offer
    // Bob will be the taker (acceptor) of the offer
    const users = usersMintsAndTokenAccounts.users;
    alice = users[0];
    bob = users[1];

    // tokenMintA represents the token Alice is offering
    // tokenMintB represents the token Alice wants in return
    const mints = usersMintsAndTokenAccounts.mints;
    tokenMintA = mints[0];
    tokenMintB = mints[1];

    const tokenAccounts = usersMintsAndTokenAccounts.tokenAccounts;

    // aliceTokenAccountA is Alice's account for tokenA (the token she's offering)
    // aliceTokenAccountB is Alice's account for tokenB (the token she wants)
    const aliceTokenAccountA = tokenAccounts[0][0];
    const aliceTokenAccountB = tokenAccounts[0][1];

    // bobTokenAccountA is Bob's account for tokenA (the token Alice is offering)
    // bobTokenAccountB is Bob's account for tokenB (the token Alice wants)
    const bobTokenAccountA = tokenAccounts[1][0];
    const bobTokenAccountB = tokenAccounts[1][1];

    // Save the accounts for later use
    accounts.maker = alice.publicKey;
    accounts.taker = bob.publicKey;
    accounts.tokenMintA = tokenMintA.publicKey;
    accounts.makerTokenAccountA = aliceTokenAccountA;
    accounts.takerTokenAccountA = bobTokenAccountA;
    accounts.tokenMintB = tokenMintB.publicKey;
    accounts.makerTokenAccountB = aliceTokenAccountB;
    accounts.takerTokenAccountB = bobTokenAccountB;
  });

  it("Puts the tokens Alice offers into the vault when Alice makes an offer", async () => {
    // Pick a random ID for the offer we'll make
    const offerId = getRandomBigNumber();

    // Then determine the account addresses we'll use for the offer and the vault
    const offer = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), accounts.maker.toBuffer(), offerId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    )[0];

    const vault = getAssociatedTokenAddressSync(accounts.tokenMintA, offer, true, TOKEN_PROGRAM);

    accounts.offer = offer;
    accounts.vault = vault;

    const transactionSignature = await program.methods
      .makeOffer(offerId, tokenAOfferedAmount, tokenBWantedAmount)
      .accountsStrict({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        maker: accounts.maker,
        makerTokenAccountA: accounts.makerTokenAccountA,
        offer: accounts.offer,
        systemProgram: SystemProgram.programId,
        tokenMintA: accounts.tokenMintA,
        tokenMintB: accounts.tokenMintB,
        tokenProgram: TOKEN_PROGRAM,
        vault: accounts.vault,
      })
      .signers([alice])
      .rpc();

    await confirmTransaction(provider.connection, transactionSignature);

    // Check our vault contains the tokens offered
    const vaultBalanceResponse = await provider.connection.getTokenAccountBalance(vault);
    const vaultBalance = new anchor.BN(vaultBalanceResponse.value.amount);
    assert(vaultBalance.eq(tokenAOfferedAmount));

    // Check our Offer account contains the correct data
    const offerAccount = await program.account.offer.fetch(offer);

    assert(offerAccount.maker.equals(alice.publicKey));
    assert(offerAccount.tokenMintA.equals(accounts.tokenMintA));
    assert(offerAccount.tokenMintB.equals(accounts.tokenMintB));
    assert(offerAccount.tokenBWantedAmount.eq(tokenBWantedAmount));
  }).slow(ANCHOR_SLOW_TEST_THRESHOLD);

  it("Puts the tokens from the vault into Bob's account, and gives Alice Bob's tokens, when Bob takes an offer", async () => {
    const transactionSignature = await program.methods
      .takeOffer()
      .accountsStrict({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        maker: accounts.maker,
        makerTokenAccountB: accounts.makerTokenAccountB,
        offer: accounts.offer,
        systemProgram: SystemProgram.programId,
        taker: accounts.taker,
        takerTokenAccountA: accounts.takerTokenAccountA,
        takerTokenAccountB: accounts.takerTokenAccountB,
        tokenMintA: accounts.tokenMintA,
        tokenMintB: accounts.tokenMintB,
        tokenProgram: TOKEN_PROGRAM,
        vault: accounts.vault,
      })
      .signers([bob])
      .rpc();

    await confirmTransaction(provider.connection, transactionSignature);

    // Check the offered tokens are now in Bob's account
    // (note: there is no before balance as Bob didn't have any offered tokens before the transaction)
    const bobTokenAccountBalanceAfterResponse = await provider.connection.getTokenAccountBalance(
      accounts.takerTokenAccountA,
    );
    const bobTokenAccountBalanceAfter = new anchor.BN(bobTokenAccountBalanceAfterResponse.value.amount);
    assert(bobTokenAccountBalanceAfter.eq(tokenAOfferedAmount));

    // Check the wanted tokens are now in Alice's account
    // (note: there is no before balance as Alice didn't have any wanted tokens before the transaction)
    const aliceTokenAccountBalanceAfterResponse = await provider.connection.getTokenAccountBalance(
      accounts.makerTokenAccountB,
    );
    const aliceTokenAccountBalanceAfter = new anchor.BN(aliceTokenAccountBalanceAfterResponse.value.amount);
    assert(aliceTokenAccountBalanceAfter.eq(tokenBWantedAmount));
  }).slow(ANCHOR_SLOW_TEST_THRESHOLD);
});
