// use litesvm::LiteSVM;
// use solana_address::Address;
// use solana_keypair::Keypair;

// /// Standard token unit for token A (1 token = 1_000_000_000 lamports for 9 decimals)
// pub const TOKEN_A: u64 = 1_000_000_000;

// /// Standard token unit for token B (1 token = 1_000_000_000 lamports for 9 decimals)
// pub const TOKEN_B: u64 = 1_000_000_000;

// /// Complete escrow test environment containing all necessary components for testing
// ///
// /// This struct holds all the accounts, keypairs, and state needed for comprehensive
// /// escrow testing scenarios. It's returned by `setup_escrow_test()` and provides
// /// a convenient way to access all test components.
// pub struct EscrowTestEnvironment {
//     /// The LiteSVM instance for simulating Solana transactions
//     pub litesvm: LiteSVM,
//     /// The escrow program ID
//     pub program_id: Address,
//     /// The mint authority that can create and mint tokens
//     pub mint_authority: Keypair,
//     /// Token mint A (the first token in escrow trades)
//     pub token_mint_a: Keypair,
//     /// Token mint B (the second token in escrow trades)
//     pub token_mint_b: Keypair,
//     /// Alice's keypair (typically the offer maker)
//     pub alice: Keypair,
//     /// Bob's keypair (typically the offer taker)
//     pub bob: Keypair,
//     /// Alice's token account for token A
//     pub alice_token_account_a: Address,
//     /// Alice's token account for token B
//     pub alice_token_account_b: Address,
//     /// Bob's token account for token A
//     pub bob_token_account_a: Address,
//     /// Bob's token account for token B
//     pub bob_token_account_b: Address,
// }
