import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  type TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { assert } from "chai";
import IDL from "../target/idl/escrow.json";
import { type Escrow } from "../target/types/escrow";
import { getRandomBigNumber } from "./utils/random-bn";
import { createAccountsMintsAndTokenAccountsInstructions } from "./utils/token";

// Work on both Token Program and new Token Extensions Program
// Use regular TOKEN_PROGRAM_ID for litesvm compatibility
const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID;

describe("escrow litesvm", () => {
  // We're going to reuse these accounts across multiple tests
  const accounts: Record<string, PublicKey> = {
    tokenProgram: TOKEN_PROGRAM,
  };

  let provider: LiteSVMProvider;
  let program: Program<Escrow>;

  let payer: Keypair;
  let alice: Keypair;
  let bob: Keypair;
  let tokenMintA: Keypair;
  let tokenMintB: Keypair;

  const tokenAOfferedAmount = new BN(1 * LAMPORTS_PER_SOL);
  const tokenBWantedAmount = new BN(1 * LAMPORTS_PER_SOL);

  before(async () => {
    const client = fromWorkspace(".");
    provider = new LiteSVMProvider(client);
    program = new Program<Escrow>(IDL, provider);

    payer = provider.wallet.payer;

    // fund the payer
    provider.client.airdrop(payer.publicKey, BigInt(100 * LAMPORTS_PER_SOL));

    // Creates Alice and Bob accounts, 2 token mints, and associated token accounts for both tokens for both users
    const usersMintsAndTokenAccounts = await createAccountsMintsAndTokenAccountsInstructions({
      connection: provider.connection,
      decimals: 9,
      lamports: 10 * LAMPORTS_PER_SOL,
      payer,
      tokenProgram: TOKEN_PROGRAM,
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

    const tx = new Transaction().add(...usersMintsAndTokenAccounts.instructions);
    await provider.sendAndConfirm(tx, usersMintsAndTokenAccounts.signers);

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

    // Calculate the vault PDA (associated token account for the offer)
    const vault = getAssociatedTokenAddressSync(accounts.tokenMintA, offer, true, TOKEN_PROGRAM);

    accounts.offer = offer;
    accounts.vault = vault;

    await program.methods
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
