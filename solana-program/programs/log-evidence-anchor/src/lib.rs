use anchor_lang::prelude::*;

declare_id!("6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3");

#[program]
pub mod log_evidence_anchor {
    use super::*;

    pub fn store_log_evidence(
        ctx: Context<StoreLogEvidence>,
        device_id: String,
        timestamp: i64,
        sha256_hex: String,
        ipfs_cid: String,
        tx_ref: String,
    ) -> Result<()> {
        require!(device_id.len() <= 64, LogEvidenceError::DeviceIdTooLong);
        require!(sha256_hex.len() == 64, LogEvidenceError::InvalidHashLength);
        require!(ipfs_cid.len() <= 96, LogEvidenceError::CidTooLong);
        require!(tx_ref.len() <= 128, LogEvidenceError::TxRefTooLong);

        let record = &mut ctx.accounts.log_record;
        record.device_id = device_id;
        record.timestamp = timestamp;
        record.sha256_hex = sha256_hex;
        record.ipfs_cid = ipfs_cid;
        record.tx_ref = tx_ref;
        record.created_at = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.log_record;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(device_id: String, timestamp: i64)]
pub struct StoreLogEvidence<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + LogRecord::MAX_SPACE,
        seeds = [b"log_record", device_id.as_bytes(), &timestamp.to_le_bytes()],
        bump
    )]
    pub log_record: Account<'info, LogRecord>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct LogRecord {
    pub device_id: String,
    pub timestamp: i64,
    pub sha256_hex: String,
    pub ipfs_cid: String,
    pub tx_ref: String,
    pub created_at: i64,
    pub bump: u8,
}

impl LogRecord {
    pub const MAX_SPACE: usize =
        (4 + 64) + // device_id
        8 + // timestamp
        (4 + 64) + // sha256_hex
        (4 + 96) + // ipfs_cid
        (4 + 128) + // tx_ref
        8 + // created_at
        1; // bump
}

#[error_code]
pub enum LogEvidenceError {
    #[msg("device_id exceeds 64 bytes")]
    DeviceIdTooLong,
    #[msg("sha256 must be 64 hex chars")]
    InvalidHashLength,
    #[msg("ipfs cid exceeds 96 bytes")]
    CidTooLong,
    #[msg("tx_ref exceeds 128 bytes")]
    TxRefTooLong,
}
