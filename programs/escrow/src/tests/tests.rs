use solana_kite::{get_pda_and_bump, seeds, send_transaction_from_instructions};
use solana_signer::Signer;
use spl_associated_token_account::get_associated_token_address;

use crate::tests::helpers::{
    build_make_offer_accounts, build_make_offer_instruction, generate_offer_id, setup_escrow_test, TOKEN_A, TOKEN_B,
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
