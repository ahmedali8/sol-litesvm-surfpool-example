use solana_kite::{
    assert_token_balance, check_account_is_closed, get_pda_and_bump, seeds, send_transaction_from_instructions,
};
use solana_signer::Signer;
use spl_associated_token_account::get_associated_token_address;

use crate::tests::helpers::{
    build_make_offer_accounts, build_make_offer_instruction, build_take_offer_accounts, build_take_offer_instruction,
    execute_make_offer, execute_take_offer, generate_offer_id, setup_escrow_test, TOKEN_A, TOKEN_B,
};

#[test]
fn test_make_offer_succeeds() {
    let mut test_env = setup_escrow_test();

    // Pick a random ID for the offer we'll make
    let offer_id = generate_offer_id();

    // Then determine the account addresses we'll use for the offer and the vault
    let (offer, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);

    // Calculate the vault PDA (associated token account for the offer)
    let vault = get_associated_token_address(&offer, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer,
        vault,
    );

    let make_offer_instruction = build_make_offer_instruction(offer_id, 1 * TOKEN_A, 1 * TOKEN_B, make_offer_accounts);

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );

    assert!(result.is_ok(), "Valid offer should succeed");
}

#[test]
fn test_duplicate_offer_id_fails() {
    let mut test_env = setup_escrow_test();

    let offer_id = generate_offer_id();
    let (offer_account, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);
    let vault = spl_associated_token_account::get_associated_token_address(&offer_account, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction = build_make_offer_instruction(offer_id, 1 * TOKEN_A, 1 * TOKEN_B, make_offer_accounts);

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_ok(), "First offer should succeed");

    // Try to create another offer with the same ID and same maker (Alice)
    let make_offer_accounts_with_existing_offer_id = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction_with_existing_offer_id =
        build_make_offer_instruction(offer_id, 1 * TOKEN_A, 1 * TOKEN_B, make_offer_accounts_with_existing_offer_id);

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction_with_existing_offer_id],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_err(), "Second offer with same ID should fail");
}

#[test]
fn test_insufficient_funds_fails() {
    let mut test_env = setup_escrow_test();

    // Try to create offer with more tokens than Alice owns
    let offer_id = generate_offer_id();
    let (offer_account, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);
    let vault = spl_associated_token_account::get_associated_token_address(&offer_account, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction = build_make_offer_instruction(
        offer_id,
        1000 * TOKEN_A, // Try to offer 1000 tokens (Alice only has 10)
        1 * TOKEN_B,
        make_offer_accounts,
    );

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_err(), "Offer with insufficient funds should fail");
}

#[test]
fn test_same_token_mints_fails() {
    let mut test_env = setup_escrow_test();

    // Try to create offer with same token mint for both token_a and token_b
    let offer_id = generate_offer_id();
    let (offer_account, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);
    let vault = spl_associated_token_account::get_associated_token_address(&offer_account, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_a, // Same mint for both
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction = build_make_offer_instruction(offer_id, 1 * TOKEN_A, 1 * TOKEN_B, make_offer_accounts);

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_err(), "Offer with same token mints should fail");
}

#[test]
fn test_zero_token_b_wanted_amount_fails() {
    let mut test_env = setup_escrow_test();

    // Try to create offer with zero token_b_wanted_amount
    let offer_id = generate_offer_id();
    let (offer_account, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);
    let vault = spl_associated_token_account::get_associated_token_address(&offer_account, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction = build_make_offer_instruction(
        offer_id,
        1 * TOKEN_A,
        0, // Zero wanted amount
        make_offer_accounts,
    );

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_err(), "Offer with zero token_b_wanted_amount should fail");
}

#[test]
fn test_zero_token_a_offered_amount_fails() {
    let mut test_env = setup_escrow_test();

    // Try to create offer with zero token_a_offered_amount
    let offer_id = generate_offer_id();
    let (offer_account, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);
    let vault = spl_associated_token_account::get_associated_token_address(&offer_account, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction = build_make_offer_instruction(
        offer_id,
        0, // Zero offered amount
        1 * TOKEN_B,
        make_offer_accounts,
    );

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_err(), "Offer with zero token_a_offered_amount should fail");
}

#[test]
fn test_take_offer_success() {
    let mut test_env = setup_escrow_test();

    // Alice creates an offer: 3 token A for 2 token B
    let offer_id = generate_offer_id();
    let alice = test_env.alice.insecure_clone();
    let alice_token_account_a = test_env.alice_token_account_a;
    let (offer_account, vault) =
        execute_make_offer(&mut test_env, offer_id, &alice, alice_token_account_a, 3 * TOKEN_A, 2 * TOKEN_B).unwrap();

    // Bob takes the offer
    let bob = test_env.bob.insecure_clone();
    let bob_token_account_a = test_env.bob_token_account_a;
    let bob_token_account_b = test_env.bob_token_account_b;
    let alice_token_account_b = test_env.alice_token_account_b;
    execute_take_offer(
        &mut test_env,
        &bob,
        &alice,
        bob_token_account_a,
        bob_token_account_b,
        alice_token_account_b,
        offer_account,
        vault,
    )
    .unwrap();

    // Check balances
    assert_token_balance(
        &test_env.litesvm,
        &test_env.alice_token_account_a,
        7 * TOKEN_A,
        "Alice should have 7 token A left",
    );
    assert_token_balance(
        &test_env.litesvm,
        &test_env.alice_token_account_b,
        2 * TOKEN_B,
        "Alice should have received 2 token B",
    );
    assert_token_balance(
        &test_env.litesvm,
        &test_env.bob_token_account_a,
        3 * TOKEN_A,
        "Bob should have received 3 token A",
    );
    assert_token_balance(
        &test_env.litesvm,
        &test_env.bob_token_account_b,
        3 * TOKEN_B,
        "Bob should have 3 token B left",
    );

    // Check that the offer account is closed after being taken
    check_account_is_closed(&test_env.litesvm, &offer_account, "Offer account should be closed after being taken");
}

#[test]
fn test_take_offer_insufficient_funds_fails() {
    let mut test_env = setup_escrow_test();

    // Create an offer from Alice for a large amount of token B
    let large_token_b_amount = 1000 * TOKEN_B; // Much larger than Bob's balance (he has 5)
    let offer_id = generate_offer_id();
    let (offer_account, _offer_bump) =
        get_pda_and_bump(&seeds!["offer", test_env.alice.pubkey(), offer_id], &test_env.program_id);
    let vault = spl_associated_token_account::get_associated_token_address(&offer_account, &test_env.token_mint_a);

    let make_offer_accounts = build_make_offer_accounts(
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.alice_token_account_a,
        offer_account,
        vault,
    );

    let make_offer_instruction =
        build_make_offer_instruction(offer_id, 1 * TOKEN_A, large_token_b_amount, make_offer_accounts);

    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![make_offer_instruction],
        &[&test_env.alice],
        &test_env.alice.pubkey(),
    );
    assert!(result.is_ok(), "Alice's offer should succeed");

    // Try to take the offer with Bob who has insufficient token B
    let take_offer_accounts = build_take_offer_accounts(
        test_env.bob.pubkey(),
        test_env.alice.pubkey(),
        test_env.token_mint_a,
        test_env.token_mint_b,
        test_env.bob_token_account_a,
        test_env.bob_token_account_b,
        test_env.alice_token_account_b,
        offer_account,
        vault,
    );

    let take_offer_instruction = build_take_offer_instruction(take_offer_accounts);
    let result = send_transaction_from_instructions(
        &mut test_env.litesvm,
        vec![take_offer_instruction],
        &[&test_env.bob],
        &test_env.bob.pubkey(),
    );
    assert!(result.is_err(), "Take offer with insufficient funds should fail");
}
