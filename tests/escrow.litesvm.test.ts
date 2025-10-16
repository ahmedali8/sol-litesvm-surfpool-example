import { randomBytes } from "node:crypto";
import { BN, Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  type TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { assert } from "chai";
import IDL from "../target/idl/escrow.json";
import { type Escrow } from "../target/types/escrow";

// Work on both Token Program and new Token Extensions Program
// Use regular TOKEN_PROGRAM_ID for litesvm compatibility
const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID;

const getRandomBigNumber = (size = 8) => {
  return new BN(randomBytes(size));
};

describe("escrow litesvm", () => {
  const client = fromWorkspace(".");
  const provider: LiteSVMProvider = new LiteSVMProvider(client);

  const payer = provider.wallet.payer;

  const program = new Program<Escrow>(IDL, provider);

  // We're going to reuse these accounts across multiple tests
  const accounts: Record<string, PublicKey> = {
    tokenProgram: TOKEN_PROGRAM,
  };

  const alice: Keypair = Keypair.generate();
  const bob: Keypair = Keypair.generate();
  const tokenMintA: Keypair = Keypair.generate();
  const tokenMintB: Keypair = Keypair.generate();

  const tokenAOfferedAmount = new BN(1 * LAMPORTS_PER_SOL);
  const tokenBWantedAmount = new BN(1 * LAMPORTS_PER_SOL);

  // fund the payer, alice, and bob
  provider.client.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  provider.client.airdrop(alice.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  provider.client.airdrop(bob.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  before(
    "Creates Alice and Bob accounts, 2 token mints, and associated token accounts for both tokens for both users",
    async () => {
      // aliceTokenAccountA is Alice's account for tokenA (the token she's offering)
      const aliceTokenAccountA = getAssociatedTokenAddressSync(
        tokenMintA.publicKey,
        alice.publicKey,
        false,
        TOKEN_PROGRAM,
      );

      // aliceTokenAccountB is Alice's account for tokenB (the token she wants)
      const aliceTokenAccountB = getAssociatedTokenAddressSync(
        tokenMintB.publicKey,
        alice.publicKey,
        false,
        TOKEN_PROGRAM,
      );

      // bobTokenAccountA is Bob's account for tokenA (the token Alice is offering)
      const bobTokenAccountA = getAssociatedTokenAddressSync(tokenMintA.publicKey, bob.publicKey, false, TOKEN_PROGRAM);

      // bobTokenAccountB is Bob's account for tokenB (the token Alice wants)
      const bobTokenAccountB = getAssociatedTokenAddressSync(tokenMintB.publicKey, bob.publicKey, false, TOKEN_PROGRAM);

      // setup token mints and ATAs
      const minimumLamports = await getMinimumBalanceForRentExemptMint(provider.connection);

      // Create token mint A
      const createMintA = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        lamports: minimumLamports,
        newAccountPubkey: tokenMintA.publicKey,
        programId: TOKEN_PROGRAM,
        space: MINT_SIZE,
      });

      // Initializes a new mint and optionally deposits all the newly minted tokens in an account.
      const initMintA = createInitializeMint2Instruction(
        tokenMintA.publicKey,
        9,
        alice.publicKey, // mint authority
        null,
        TOKEN_PROGRAM,
      );

      // Create the ATA
      const createAliceTokenAccountA = createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        aliceTokenAccountA,
        alice.publicKey,
        tokenMintA.publicKey,
        TOKEN_PROGRAM,
      );

      // Mint some tokens to the ATA
      const mintToAliceA = createMintToInstruction(
        tokenMintA.publicKey,
        aliceTokenAccountA,
        alice.publicKey,
        1000 * LAMPORTS_PER_SOL, // 1000 tokens with 9 decimals
        [],
        TOKEN_PROGRAM,
      );

      // Create token mint B
      const createMintB = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        lamports: minimumLamports,
        newAccountPubkey: tokenMintB.publicKey,
        programId: TOKEN_PROGRAM,
        space: MINT_SIZE,
      });

      // Initializes a new mint and optionally deposits all the newly minted tokens in an account.
      const initMintB = createInitializeMint2Instruction(
        tokenMintB.publicKey,
        9,
        bob.publicKey, // mint authority
        null,
        TOKEN_PROGRAM,
      );

      // Create the ATA
      const createBobTokenAccountB = createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        bobTokenAccountB,
        bob.publicKey,
        tokenMintB.publicKey,
        TOKEN_PROGRAM,
      );

      // Mint some tokens to the ATA
      const mintToBobB = createMintToInstruction(
        tokenMintB.publicKey,
        bobTokenAccountB,
        bob.publicKey,
        1000 * LAMPORTS_PER_SOL, // 1000 tokens with 9 decimals
        [],
        TOKEN_PROGRAM,
      );

      const tx = new Transaction().add(
        createMintA,
        initMintA,
        createAliceTokenAccountA,
        mintToAliceA,
        createMintB,
        initMintB,
        createBobTokenAccountB,
        mintToBobB,
      );

      await provider.sendAndConfirm(tx, [alice, bob, tokenMintA, tokenMintB, payer]);

      // Save the accounts for later use
      accounts.maker = alice.publicKey;
      accounts.taker = bob.publicKey;
      accounts.tokenMintA = tokenMintA.publicKey;
      accounts.makerTokenAccountA = aliceTokenAccountA;
      accounts.takerTokenAccountA = bobTokenAccountA;
      accounts.tokenMintB = tokenMintB.publicKey;
      accounts.makerTokenAccountB = aliceTokenAccountB;
      accounts.takerTokenAccountB = bobTokenAccountB;
    },
  );

  it("Puts the tokens Alice offers into the vault when Alice makes an offer", async () => {
    // Pick a random ID for the offer we'll make
    const offerId = getRandomBigNumber();

    // Then determine the account addresses we'll use for the offer and the vault
    const offer = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), accounts.maker.toBuffer(), offerId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    )[0];

    // Calculate the vault PDA (associated token account for the offer)
    const vault = getAssociatedTokenAddressSync(accounts.tokenMintA, offer, true, TOKEN_PROGRAM);

    accounts.offer = offer;
    accounts.vault = vault;

    await program.methods
      .makeOffer(offerId, tokenAOfferedAmount, tokenBWantedAmount)
      .accounts({ ...accounts })
      .signers([alice])
      .rpc();

    // Check our vault contains the tokens offered
    const vaultAccount = await getAccount(provider.connection, vault);
    const vaultBalance = new BN(vaultAccount.amount);
    assert(vaultBalance.eq(tokenAOfferedAmount));

    // Check our Offer account contains the correct data
    const offerAccount = await program.account.offer.fetch(offer);

    assert(offerAccount.maker.equals(alice.publicKey));
    assert(offerAccount.tokenMintA.equals(accounts.tokenMintA));
    assert(offerAccount.tokenMintB.equals(accounts.tokenMintB));
    assert(offerAccount.tokenBWantedAmount.eq(tokenBWantedAmount));
  });

  it("Puts the tokens from the vault into Bob's account, and gives Alice Bob's tokens, when Bob takes an offer", async () => {
    await program.methods
      .takeOffer()
      .accounts({ ...accounts })
      .signers([bob])
      .rpc();

    // Check the offered tokens are now in Bob's account
    // (note: there is no before balance as Bob didn't have any offered tokens before the transaction)
    const bobTokenAccount = await getAccount(provider.connection, accounts.takerTokenAccountA);
    const bobTokenAccountBalanceAfter = new BN(bobTokenAccount.amount);
    assert(bobTokenAccountBalanceAfter.eq(tokenAOfferedAmount));

    // Check the wanted tokens are now in Alice's account
    // (note: there is no before balance as Alice didn't have any wanted tokens before the transaction)
    const aliceTokenAccount = await getAccount(provider.connection, accounts.makerTokenAccountB);
    const aliceTokenAccountBalanceAfter = new BN(aliceTokenAccount.amount);
    assert(aliceTokenAccountBalanceAfter.eq(tokenBWantedAmount));
  });
});
