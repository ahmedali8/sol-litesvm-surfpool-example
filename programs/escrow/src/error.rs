use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Token mints must be different")]
    SameTokenMints,
    #[msg("Offered amount must be greater than zero")]
    ZeroOfferedAmount,
    #[msg("Wanted amount must be greater than zero")]
    ZeroWantedAmount,
}
