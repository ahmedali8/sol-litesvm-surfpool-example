use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Offer {
    pub id: u64,                    // Unique offer identifier
    pub maker: Pubkey,              // Creator of the offer
    pub token_mint_a: Pubkey,       // Token being offered
    pub token_mint_b: Pubkey,       // Token wanted in return
    pub token_b_wanted_amount: u64, // Amount of token B wanted
    pub bump: u8,                   // PDA bump seed
}
