use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionToken};

declare_id!("7ApsvRSqfqCA5YbSSvAmeboFFU7hyB2HJBCpEiwmLSSi");

// ============= CONSTANTS =============

/// Unified starting balance: 100,000 USD (6 decimals) — shared across
/// prediction markets, spot, perps, limit orders.
pub const INITIAL_BALANCE: u64 = 100_000_000_000;

/// Maintenance margin for perp liquidation: 50 bps = 0.5%
pub const MAINTENANCE_MARGIN_BPS: u128 = 50;

/// Price fixed-point scale (6 decimals)
pub const PRICE_SCALE: u128 = 1_000_000;

/// Max price per prediction share: $1.00 (6 decimals)
pub const MAX_PREDICTION_PRICE: u64 = 1_000_000;

/// Competition duration bounds (seconds).
pub const COMP_MIN_DURATION_SECS: i64 = 3 * 86_400;
pub const COMP_MAX_DURATION_SECS: i64 = 21 * 86_400;
/// Minimum participant count: enough to fill a top-3 podium.
pub const COMP_MIN_PARTICIPANTS: u64 = 3;
/// Reward split (basis points, sums to 10_000).
pub const COMP_REWARD_FIRST_BPS: u64 = 5_000;
pub const COMP_REWARD_SECOND_BPS: u64 = 3_000;
pub const COMP_REWARD_THIRD_BPS: u64 = 1_500;
pub const COMP_REWARD_TREASURY_BPS: u64 = 500;
/// Max competition name length (bytes).
pub const COMP_NAME_MAX_LEN: usize = 32;

// ============= ENUMS =============

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum MarketCategory {
    #[default]
    Crypto,
    Stock,
    Forex,
    Metal,
    Equity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum TradeMode {
    #[default]
    Spot,
    Perp,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum Direction {
    #[default]
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum OrderType {
    #[default]
    Market,
    Limit,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum PositionStatus {
    #[default]
    PendingFill,
    Active,
    Closed,
    Liquidated,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum CloseReason {
    #[default]
    None,
    Manual,
    TakeProfit,
    StopLoss,
    Liquidation,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum PredictionType {
    #[default]
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum PredictionStatus {
    #[default]
    Active,
    PartiallySold,
    FullySold,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default, InitSpace)]
pub enum CompetitionStatus {
    /// Accepting joiners; trading not yet possible.
    #[default]
    Pending,
    /// Target allocation reached; trading window open until `end_ts`.
    Active,
    /// Rewards paid out; participants can call `claim_competition_exit`.
    Settled,
}

// ============= ACCOUNTS =============

#[account]
pub struct ProgramConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub authorized_executors: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(Default, InitSpace)]
pub struct UserAccount {
    pub owner: Pubkey,
    /// Unified USD balance (6 decimals). Includes margin currently locked in
    /// open trading positions; available = usd_balance - locked_margin_usd.
    pub usd_balance: u64,
    /// Margin locked in active/pending trading positions (6 decimals)
    pub locked_margin_usd: u64,
    /// Counter — used as PDA seed for trading positions
    pub total_trading_positions: u64,
    /// Counter — used as PDA seed for prediction positions
    pub total_prediction_positions: u64,
    pub created_at: i64,
    pub bump: u8,
    /// Pubkey::default() when not in a competition. Set on `join_competition`,
    /// cleared on `claim_competition_exit` after the comp settles. Enforces
    /// "one active competition at a time" per user.
    pub active_competition: Pubkey,
}

/// Unified spot/perp/market/limit position (crypto + traditional markets).
#[account]
#[derive(Default, InitSpace)]
pub struct TradingPosition {
    pub owner: Pubkey,
    pub position_id: u64,
    pub market_category: MarketCategory,
    /// Category-scoped asset ID (e.g. Crypto: 0=SOL,1=BTC,...; Stock: 0=AAPL,1=TSLA,...)
    pub pair_index: u8,
    pub trade_mode: TradeMode,
    pub direction: Direction,
    pub order_type: OrderType,
    pub size_usd: u64,
    pub margin_usd: u64,
    pub leverage: u8,
    pub entry_price: u64,
    pub limit_price: u64,
    pub take_profit_price: u64,
    pub stop_loss_price: u64,
    pub liquidation_price: u64,
    pub status: PositionStatus,
    pub opened_at: i64,
    pub filled_at: i64,
    pub closed_at: i64,
    pub close_price: u64,
    pub realized_pnl: i64,
    pub close_reason: CloseReason,
    pub bump: u8,
}

/// One slot of the top-3 leaderboard cached on `Competition`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct LeaderEntry {
    pub participant: Pubkey,
    pub balance: u64,
}

/// Onchain trading competition. Holds config, escrow accounting and the
/// running top-3. SOL escrow is stored on a separate vault PDA so the program
/// can sign payouts at settle time.
#[account]
#[derive(Default, InitSpace)]
pub struct Competition {
    pub creator: Pubkey,
    /// Fixed-size name (right-padded with zeros). Length tracked separately.
    pub name: [u8; COMP_NAME_MAX_LEN],
    pub name_len: u8,
    pub entry_ticket_lamports: u64,
    pub target_lamports: u64,
    pub duration_secs: i64,
    /// Stamped on auto-start (when target is reached). 0 while pending.
    pub start_ts: i64,
    /// `start_ts + duration_secs`. 0 while pending.
    pub end_ts: i64,
    pub status: CompetitionStatus,
    pub participant_count: u64,
    pub max_participants: u64,
    /// Lamports collected so far (running tally as users join).
    pub prize_pool: u64,
    pub top: [LeaderEntry; 3],
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Polymarket-style YES/NO prediction position.
#[account]
#[derive(Default, InitSpace)]
pub struct PredictionPosition {
    pub owner: Pubkey,
    pub position_id: u64,
    #[max_len(128)]
    pub market_id: String,
    pub prediction_type: PredictionType,
    pub amount_usd: u64,
    pub price_per_share: u64,
    pub shares: u64,
    pub remaining_shares: u64,
    pub total_sold_shares: u64,
    pub average_sell_price: u64,
    pub status: PredictionStatus,
    pub opened_at: i64,
    pub closed_at: i64,
    pub stop_loss: u64,
    pub take_profit: u64,
    pub bump: u8,
}

// ============= PROGRAM =============

#[program]
pub mod hashfox {
    use super::*;

    // ─── Admin ────────────────────────────────────────────────────────────────

    pub fn initialize_config(ctx: Context<InitializeConfig>, treasury: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = treasury;
        config.authorized_executors = Vec::new();
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            authority: config.authority,
            treasury: config.treasury,
        });
        Ok(())
    }

    pub fn add_executor(ctx: Context<UpdateExecutors>, executor: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            !config.authorized_executors.contains(&executor),
            ErrorCode::ExecutorAlreadyExists
        );
        config.authorized_executors.push(executor);
        emit!(ExecutorAdded { executor });
        Ok(())
    }

    pub fn remove_executor(ctx: Context<UpdateExecutors>, executor: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authorized_executors.retain(|&x| x != executor);
        emit!(ExecutorRemoved { executor });
        Ok(())
    }

    // ─── User account ─────────────────────────────────────────────────────────

    /// Create the user's unified paper-trading account and credit 100,000 USD
    /// that is shared across prediction markets, spot, perps, and limit orders.
    /// Pays a small real SOL entry fee to the treasury.
    pub fn initialize_user_account(
        ctx: Context<InitializeUserAccount>,
        entry_fee: u64,
    ) -> Result<()> {
        require!(entry_fee >= 100_000_000, ErrorCode::EntryFeeTooLow); // min 0.1 SOL

        let clock = Clock::get()?;
        let ua = &mut ctx.accounts.user_account;
        ua.owner = ctx.accounts.user.key();
        ua.usd_balance = INITIAL_BALANCE;
        ua.locked_margin_usd = 0;
        ua.total_trading_positions = 0;
        ua.total_prediction_positions = 0;
        ua.created_at = clock.unix_timestamp;
        ua.bump = ctx.bumps.user_account;
        ua.active_competition = Pubkey::default();

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_ctx, entry_fee)?;

        emit!(AccountInitialized {
            user: ua.owner,
            initial_balance: INITIAL_BALANCE,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    // ─── Trading (spot / perp, market / limit) ────────────────────────────────

    /// Open a market position (spot or perp), filled immediately at `entry_price`.
    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn open_market_position(
        ctx: Context<OpenTradingPositionCtx>,
        market_category: MarketCategory,
        pair_index: u8,
        trade_mode: TradeMode,
        direction: Direction,
        margin_usd: u64,
        leverage: u8,
        take_profit_price: u64,
        stop_loss_price: u64,
        entry_price: u64,
    ) -> Result<()> {
        open_market_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_category,
            pair_index,
            trade_mode,
            direction,
            margin_usd,
            leverage,
            take_profit_price,
            stop_loss_price,
            entry_price,
        )
    }

    /// Place a limit order (spot or perp). Margin is locked immediately; the
    /// position sits in `PendingFill` until an executor fills it at a
    /// favorable price.
    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn open_limit_order(
        ctx: Context<OpenTradingPositionCtx>,
        market_category: MarketCategory,
        pair_index: u8,
        trade_mode: TradeMode,
        direction: Direction,
        margin_usd: u64,
        leverage: u8,
        limit_price: u64,
        take_profit_price: u64,
        stop_loss_price: u64,
    ) -> Result<()> {
        open_limit_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_category,
            pair_index,
            trade_mode,
            direction,
            margin_usd,
            leverage,
            limit_price,
            take_profit_price,
            stop_loss_price,
        )
    }

    /// Cancel a pending limit order. Returns locked margin to available balance.
    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn cancel_limit_order(ctx: Context<UserTradingAction>) -> Result<()> {
        cancel_limit_inner(&mut ctx.accounts.user_account, &mut ctx.accounts.position)
    }

    /// Manually close an active trading position at `current_price`.
    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn close_trading_position(
        ctx: Context<UserTradingAction>,
        current_price: u64,
    ) -> Result<()> {
        let pos = &mut ctx.accounts.position;
        let ua = &mut ctx.accounts.user_account;

        require!(pos.status == PositionStatus::Active, ErrorCode::PositionNotActive);
        require!(current_price > 0, ErrorCode::InvalidPrice);

        settle_trading_position(pos, ua, current_price, CloseReason::Manual)?;
        Ok(())
    }

    // ─── Executor-only trading helpers ────────────────────────────────────────

    pub fn fill_limit_order(ctx: Context<ExecutorTradingAction>, current_price: u64) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        fill_limit_inner(&mut ctx.accounts.position, current_price)
    }

    pub fn execute_tp_sl(ctx: Context<ExecutorTradingAction>, current_price: u64) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        execute_tp_sl_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    pub fn liquidate_position(ctx: Context<ExecutorTradingAction>, current_price: u64) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        liquidate_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    // ─── Prediction markets (YES/NO) ──────────────────────────────────────────

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn buy_yes(
        ctx: Context<OpenPredictionCtx>,
        market_id: String,
        amount_usd: u64,
        price_per_share: u64,
        stop_loss: u64,
        take_profit: u64,
    ) -> Result<()> {
        open_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_id,
            amount_usd,
            price_per_share,
            stop_loss,
            take_profit,
            PredictionType::Yes,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn buy_no(
        ctx: Context<OpenPredictionCtx>,
        market_id: String,
        amount_usd: u64,
        price_per_share: u64,
        stop_loss: u64,
        take_profit: u64,
    ) -> Result<()> {
        open_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_id,
            amount_usd,
            price_per_share,
            stop_loss,
            take_profit,
            PredictionType::No,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn sell_yes(
        ctx: Context<SellPredictionCtx>,
        shares_to_sell: u64,
        current_price: u64,
    ) -> Result<()> {
        sell_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            shares_to_sell,
            current_price,
            PredictionType::Yes,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn sell_no(
        ctx: Context<SellPredictionCtx>,
        shares_to_sell: u64,
        current_price: u64,
    ) -> Result<()> {
        sell_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            shares_to_sell,
            current_price,
            PredictionType::No,
        )
    }

    /// Manually close a prediction position at `current_price` (full exit).
    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn close_prediction_position(
        ctx: Context<SellPredictionCtx>,
        current_price: u64,
    ) -> Result<()> {
        close_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    /// Executor-only auto-close when SL or TP is met on a prediction position.
    pub fn close_prediction_auto(
        ctx: Context<ExecutorPredictionAction>,
        current_price: u64,
    ) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        close_prediction_auto_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    /// One-time migration: reallocates pre-competition `UserAccount`s that
    /// were created before the `active_competition: Pubkey` field was added,
    /// and zero-initialises the new trailing 32 bytes (= `Pubkey::default()`).
    /// No-op on already-migrated accounts.
    pub fn migrate_user_account(ctx: Context<MigrateUserAccount>) -> Result<()> {
        let info = ctx.accounts.user_account.to_account_info();
        let new_len = 8usize + UserAccount::INIT_SPACE;
        let cur_len = info.data_len();
        if cur_len >= new_len {
            return Ok(());
        }
        let rent = Rent::get()?;
        let needed = rent.minimum_balance(new_len);
        let have = info.lamports();
        if needed > have {
            let diff = needed - have;
            let cpi = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: info.clone(),
                },
            );
            anchor_lang::system_program::transfer(cpi, diff)?;
        }
        info.realloc(new_len, true)?;
        // The new bytes (active_competition) are zero-initialised by realloc,
        // which is exactly Pubkey::default(). Nothing else to write.
        Ok(())
    }

    // ─── Competitions ─────────────────────────────────────────────────────────

    /// Create a new competition. The creator only configures it — they don't
    /// auto-join, and they have no privileged role afterwards. Status starts
    /// as `Pending` and flips to `Active` automatically once `participant_count
    /// * entry_ticket_lamports >= target_lamports` in `join_competition`.
    pub fn create_competition(
        ctx: Context<CreateCompetition>,
        name: String,
        entry_ticket_lamports: u64,
        target_lamports: u64,
        duration_secs: i64,
    ) -> Result<()> {
        require!(!name.is_empty(), ErrorCode::CompetitionNameInvalid);
        require!(
            name.len() <= COMP_NAME_MAX_LEN,
            ErrorCode::CompetitionNameInvalid
        );
        require!(entry_ticket_lamports > 0, ErrorCode::InvalidEntryTicket);
        require!(
            target_lamports >= entry_ticket_lamports
                .checked_mul(COMP_MIN_PARTICIPANTS)
                .unwrap(),
            ErrorCode::InvalidTargetAllocation
        );
        require!(
            target_lamports % entry_ticket_lamports == 0,
            ErrorCode::InvalidTargetAllocation
        );
        require!(
            duration_secs >= COMP_MIN_DURATION_SECS && duration_secs <= COMP_MAX_DURATION_SECS,
            ErrorCode::InvalidCompetitionDuration
        );

        let comp = &mut ctx.accounts.competition;
        comp.creator = ctx.accounts.creator.key();
        let bytes = name.as_bytes();
        comp.name = [0u8; COMP_NAME_MAX_LEN];
        comp.name[..bytes.len()].copy_from_slice(bytes);
        comp.name_len = bytes.len() as u8;
        comp.entry_ticket_lamports = entry_ticket_lamports;
        comp.target_lamports = target_lamports;
        comp.duration_secs = duration_secs;
        comp.start_ts = 0;
        comp.end_ts = 0;
        comp.status = CompetitionStatus::Pending;
        comp.participant_count = 0;
        comp.max_participants = target_lamports / entry_ticket_lamports;
        comp.prize_pool = 0;
        comp.top = [LeaderEntry::default(); 3];
        comp.created_at = Clock::get()?.unix_timestamp;
        comp.bump = ctx.bumps.competition;
        comp.vault_bump = ctx.bumps.vault;

        emit!(CompetitionCreated {
            competition: comp.key(),
            creator: comp.creator,
            entry_ticket_lamports,
            target_lamports,
            duration_secs,
            max_participants: comp.max_participants,
            timestamp: comp.created_at,
        });
        Ok(())
    }

    /// Join a competition: pay entry ticket → competition vault, init the
    /// per-comp `UserAccount` with 100k virtual balance, mark the user's main
    /// account as in-comp. If this entry fills the target, status flips to
    /// `Active` and `end_ts` is stamped — no creator action needed.
    pub fn join_competition(ctx: Context<JoinCompetition>) -> Result<()> {
        let comp = &mut ctx.accounts.competition;
        require!(
            comp.status == CompetitionStatus::Pending,
            ErrorCode::CompetitionNotJoinable
        );
        require!(
            comp.participant_count < comp.max_participants,
            ErrorCode::CompetitionFull
        );

        let main_ua = &mut ctx.accounts.user_account;
        require!(
            main_ua.active_competition == Pubkey::default(),
            ErrorCode::AlreadyInCompetition
        );

        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi, comp.entry_ticket_lamports)?;

        let clock = Clock::get()?;
        let comp_ua = &mut ctx.accounts.comp_user_account;
        comp_ua.owner = ctx.accounts.user.key();
        comp_ua.usd_balance = INITIAL_BALANCE;
        comp_ua.locked_margin_usd = 0;
        comp_ua.total_trading_positions = 0;
        comp_ua.total_prediction_positions = 0;
        comp_ua.created_at = clock.unix_timestamp;
        comp_ua.bump = ctx.bumps.comp_user_account;
        comp_ua.active_competition = comp.key();

        main_ua.active_competition = comp.key();

        comp.participant_count = comp.participant_count.checked_add(1).unwrap();
        comp.prize_pool = comp
            .prize_pool
            .checked_add(comp.entry_ticket_lamports)
            .unwrap();

        emit!(CompetitionJoined {
            competition: comp.key(),
            participant: ctx.accounts.user.key(),
            participant_count: comp.participant_count,
            prize_pool: comp.prize_pool,
            timestamp: clock.unix_timestamp,
        });

        // Auto-start when target is reached.
        if comp.prize_pool >= comp.target_lamports {
            comp.status = CompetitionStatus::Active;
            comp.start_ts = clock.unix_timestamp;
            comp.end_ts = clock
                .unix_timestamp
                .checked_add(comp.duration_secs)
                .ok_or(ErrorCode::InvalidCompetitionDuration)?;
            emit!(CompetitionStarted {
                competition: comp.key(),
                start_ts: comp.start_ts,
                end_ts: comp.end_ts,
                participant_count: comp.participant_count,
                prize_pool: comp.prize_pool,
            });
        }

        Ok(())
    }

    /// Permissionless: anyone can submit a participant's current `usd_balance`
    /// for inclusion in the comp's running top-3 cache. The PDA derivation of
    /// `comp_user_account` is checked by Anchor (seeds = `[b"comp_user", comp,
    /// owner]`), so there's no spoofing — caller can only submit a real comp
    /// participant's real on-chain balance.
    pub fn report_score(ctx: Context<ReportScore>) -> Result<()> {
        let comp = &mut ctx.accounts.competition;
        require!(
            comp.status == CompetitionStatus::Active,
            ErrorCode::CompetitionNotActive
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now < comp.end_ts, ErrorCode::CompetitionEnded);

        let comp_ua = &ctx.accounts.comp_user_account;
        let participant = comp_ua.owner;
        let balance = comp_ua.usd_balance;

        if update_top3(&mut comp.top, participant, balance) {
            emit!(ScoreReported {
                competition: comp.key(),
                participant,
                balance,
                top: comp.top,
            });
        }
        Ok(())
    }

    /// Permissionless: callable after `end_ts`. Pays 50/30/15/5 from the vault
    /// PDA to top-3 + treasury and flips status to `Settled`. Empty podium
    /// slots route to treasury so funds never get stuck.
    pub fn settle_competition(ctx: Context<SettleCompetition>) -> Result<()> {
        let comp = &mut ctx.accounts.competition;
        require!(
            comp.status == CompetitionStatus::Active,
            ErrorCode::CompetitionNotActive
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now >= comp.end_ts, ErrorCode::CompetitionNotEnded);

        let pool = comp.prize_pool;
        let first = pool.checked_mul(COMP_REWARD_FIRST_BPS).unwrap() / 10_000;
        let second = pool.checked_mul(COMP_REWARD_SECOND_BPS).unwrap() / 10_000;
        let third = pool.checked_mul(COMP_REWARD_THIRD_BPS).unwrap() / 10_000;
        let mut treasury_amt = pool
            .checked_sub(first)
            .and_then(|v| v.checked_sub(second))
            .and_then(|v| v.checked_sub(third))
            .ok_or(ErrorCode::PrizePoolMath)?;

        let comp_key = comp.key();
        let vault_bump = [comp.vault_bump];
        let vault_seeds: &[&[u8]] = &[b"comp_vault", comp_key.as_ref(), &vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

        // Verify provided podium accounts match the cached top — empty slots
        // route to treasury so funds never get stuck.
        if comp.top[0].participant == Pubkey::default() {
            treasury_amt = treasury_amt.checked_add(first).unwrap();
        } else {
            require!(
                ctx.accounts.first_place.key() == comp.top[0].participant,
                ErrorCode::PodiumAccountMismatch
            );
            if first > 0 {
                let cpi = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.first_place.to_account_info(),
                    },
                    signer_seeds,
                );
                anchor_lang::system_program::transfer(cpi, first)?;
            }
        }

        if comp.top[1].participant == Pubkey::default() {
            treasury_amt = treasury_amt.checked_add(second).unwrap();
        } else {
            require!(
                ctx.accounts.second_place.key() == comp.top[1].participant,
                ErrorCode::PodiumAccountMismatch
            );
            if second > 0 {
                let cpi = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.second_place.to_account_info(),
                    },
                    signer_seeds,
                );
                anchor_lang::system_program::transfer(cpi, second)?;
            }
        }

        if comp.top[2].participant == Pubkey::default() {
            treasury_amt = treasury_amt.checked_add(third).unwrap();
        } else {
            require!(
                ctx.accounts.third_place.key() == comp.top[2].participant,
                ErrorCode::PodiumAccountMismatch
            );
            if third > 0 {
                let cpi = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.third_place.to_account_info(),
                    },
                    signer_seeds,
                );
                anchor_lang::system_program::transfer(cpi, third)?;
            }
        }

        if treasury_amt > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                signer_seeds,
            );
            anchor_lang::system_program::transfer(cpi, treasury_amt)?;
        }

        comp.status = CompetitionStatus::Settled;

        emit!(CompetitionSettled {
            competition: comp.key(),
            first: comp.top[0].participant,
            first_amount: if comp.top[0].participant == Pubkey::default() { 0 } else { first },
            second: comp.top[1].participant,
            second_amount: if comp.top[1].participant == Pubkey::default() { 0 } else { second },
            third: comp.top[2].participant,
            third_amount: if comp.top[2].participant == Pubkey::default() { 0 } else { third },
            treasury_amount: treasury_amt,
            timestamp: now,
        });
        Ok(())
    }

    /// Clear `active_competition` on the user's main account once the
    /// competition has settled, unblocking them to join the next one.
    pub fn claim_competition_exit(ctx: Context<ClaimCompetitionExit>) -> Result<()> {
        let comp = &ctx.accounts.competition;
        require!(
            comp.status == CompetitionStatus::Settled,
            ErrorCode::CompetitionNotSettled
        );
        let main_ua = &mut ctx.accounts.user_account;
        require!(
            main_ua.active_competition == comp.key(),
            ErrorCode::NotInThisCompetition
        );
        main_ua.active_competition = Pubkey::default();
        emit!(CompetitionExitClaimed {
            competition: comp.key(),
            participant: main_ua.owner,
        });
        Ok(())
    }

    // ─── Competition-scoped trading (mirrors normal trading instructions) ─────

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_open_market_position(
        ctx: Context<CompOpenTradingPositionCtx>,
        market_category: MarketCategory,
        pair_index: u8,
        trade_mode: TradeMode,
        direction: Direction,
        margin_usd: u64,
        leverage: u8,
        take_profit_price: u64,
        stop_loss_price: u64,
        entry_price: u64,
    ) -> Result<()> {
        require_competition_active(&ctx.accounts.competition)?;
        open_market_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_category,
            pair_index,
            trade_mode,
            direction,
            margin_usd,
            leverage,
            take_profit_price,
            stop_loss_price,
            entry_price,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_open_limit_order(
        ctx: Context<CompOpenTradingPositionCtx>,
        market_category: MarketCategory,
        pair_index: u8,
        trade_mode: TradeMode,
        direction: Direction,
        margin_usd: u64,
        leverage: u8,
        limit_price: u64,
        take_profit_price: u64,
        stop_loss_price: u64,
    ) -> Result<()> {
        require_competition_active(&ctx.accounts.competition)?;
        open_limit_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_category,
            pair_index,
            trade_mode,
            direction,
            margin_usd,
            leverage,
            limit_price,
            take_profit_price,
            stop_loss_price,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_cancel_limit_order(ctx: Context<CompUserTradingAction>) -> Result<()> {
        cancel_limit_inner(&mut ctx.accounts.user_account, &mut ctx.accounts.position)
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_close_trading_position(
        ctx: Context<CompUserTradingAction>,
        current_price: u64,
    ) -> Result<()> {
        let pos = &mut ctx.accounts.position;
        let ua = &mut ctx.accounts.user_account;
        require!(pos.status == PositionStatus::Active, ErrorCode::PositionNotActive);
        require!(current_price > 0, ErrorCode::InvalidPrice);
        settle_trading_position(pos, ua, current_price, CloseReason::Manual)
    }

    pub fn comp_fill_limit_order(
        ctx: Context<CompExecutorTradingAction>,
        current_price: u64,
    ) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        fill_limit_inner(&mut ctx.accounts.position, current_price)
    }

    pub fn comp_execute_tp_sl(
        ctx: Context<CompExecutorTradingAction>,
        current_price: u64,
    ) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        execute_tp_sl_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    pub fn comp_liquidate_position(
        ctx: Context<CompExecutorTradingAction>,
        current_price: u64,
    ) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        liquidate_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_buy_yes(
        ctx: Context<CompOpenPredictionCtx>,
        market_id: String,
        amount_usd: u64,
        price_per_share: u64,
        stop_loss: u64,
        take_profit: u64,
    ) -> Result<()> {
        require_competition_active(&ctx.accounts.competition)?;
        open_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_id,
            amount_usd,
            price_per_share,
            stop_loss,
            take_profit,
            PredictionType::Yes,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_buy_no(
        ctx: Context<CompOpenPredictionCtx>,
        market_id: String,
        amount_usd: u64,
        price_per_share: u64,
        stop_loss: u64,
        take_profit: u64,
    ) -> Result<()> {
        require_competition_active(&ctx.accounts.competition)?;
        open_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            ctx.bumps.position,
            market_id,
            amount_usd,
            price_per_share,
            stop_loss,
            take_profit,
            PredictionType::No,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_sell_yes(
        ctx: Context<CompSellPredictionCtx>,
        shares_to_sell: u64,
        current_price: u64,
    ) -> Result<()> {
        sell_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            shares_to_sell,
            current_price,
            PredictionType::Yes,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_sell_no(
        ctx: Context<CompSellPredictionCtx>,
        shares_to_sell: u64,
        current_price: u64,
    ) -> Result<()> {
        sell_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            shares_to_sell,
            current_price,
            PredictionType::No,
        )
    }

    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn comp_close_prediction_position(
        ctx: Context<CompSellPredictionCtx>,
        current_price: u64,
    ) -> Result<()> {
        close_prediction_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }

    pub fn comp_close_prediction_auto(
        ctx: Context<CompExecutorPredictionAction>,
        current_price: u64,
    ) -> Result<()> {
        require_executor(&ctx.accounts.config, &ctx.accounts.executor.key())?;
        close_prediction_auto_inner(
            &mut ctx.accounts.user_account,
            &mut ctx.accounts.position,
            current_price,
        )
    }
}

// ============= INTERNAL HELPERS =============

fn require_executor(config: &ProgramConfig, executor: &Pubkey) -> Result<()> {
    require!(
        config.authorized_executors.contains(executor),
        ErrorCode::UnauthorizedExecutor
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn open_market_inner(
    ua: &mut UserAccount,
    pos: &mut TradingPosition,
    pos_bump: u8,
    market_category: MarketCategory,
    pair_index: u8,
    trade_mode: TradeMode,
    direction: Direction,
    margin_usd: u64,
    leverage: u8,
    take_profit_price: u64,
    stop_loss_price: u64,
    entry_price: u64,
) -> Result<()> {
    validate_leverage(&trade_mode, leverage)?;
    require!(margin_usd > 0, ErrorCode::InvalidMargin);
    require!(entry_price > 0, ErrorCode::InvalidPrice);

    let available = ua
        .usd_balance
        .checked_sub(ua.locked_margin_usd)
        .ok_or(ErrorCode::InsufficientBalance)?;
    require!(available >= margin_usd, ErrorCode::InsufficientBalance);

    let size_usd = (margin_usd as u128)
        .checked_mul(leverage as u128)
        .unwrap() as u64;

    if take_profit_price > 0 || stop_loss_price > 0 {
        validate_tp_sl(&direction, entry_price, take_profit_price, stop_loss_price)?;
    }

    let liquidation_price = if trade_mode == TradeMode::Perp {
        compute_liquidation_price(entry_price, leverage, &direction)
    } else {
        0
    };

    ua.locked_margin_usd = ua.locked_margin_usd.checked_add(margin_usd).unwrap();

    let clock = Clock::get()?;
    let position_id = ua.total_trading_positions;

    pos.owner = ua.owner;
    pos.position_id = position_id;
    pos.market_category = market_category.clone();
    pos.pair_index = pair_index;
    pos.trade_mode = trade_mode.clone();
    pos.direction = direction.clone();
    pos.order_type = OrderType::Market;
    pos.size_usd = size_usd;
    pos.margin_usd = margin_usd;
    pos.leverage = leverage;
    pos.entry_price = entry_price;
    pos.limit_price = 0;
    pos.take_profit_price = take_profit_price;
    pos.stop_loss_price = stop_loss_price;
    pos.liquidation_price = liquidation_price;
    pos.status = PositionStatus::Active;
    pos.opened_at = clock.unix_timestamp;
    pos.filled_at = clock.unix_timestamp;
    pos.closed_at = 0;
    pos.close_price = 0;
    pos.realized_pnl = 0;
    pos.close_reason = CloseReason::None;
    pos.bump = pos_bump;

    ua.total_trading_positions = ua.total_trading_positions.checked_add(1).unwrap();

    emit!(TradingPositionOpened {
        user: ua.owner,
        position_id,
        market_category,
        pair_index,
        trade_mode,
        direction,
        order_type: OrderType::Market,
        size_usd,
        margin_usd,
        leverage,
        entry_price,
        limit_price: 0,
        take_profit_price,
        stop_loss_price,
        liquidation_price,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn open_limit_inner(
    ua: &mut UserAccount,
    pos: &mut TradingPosition,
    pos_bump: u8,
    market_category: MarketCategory,
    pair_index: u8,
    trade_mode: TradeMode,
    direction: Direction,
    margin_usd: u64,
    leverage: u8,
    limit_price: u64,
    take_profit_price: u64,
    stop_loss_price: u64,
) -> Result<()> {
    validate_leverage(&trade_mode, leverage)?;
    require!(margin_usd > 0, ErrorCode::InvalidMargin);
    require!(limit_price > 0, ErrorCode::InvalidLimitPrice);

    let available = ua
        .usd_balance
        .checked_sub(ua.locked_margin_usd)
        .ok_or(ErrorCode::InsufficientBalance)?;
    require!(available >= margin_usd, ErrorCode::InsufficientBalance);

    if take_profit_price > 0 || stop_loss_price > 0 {
        validate_tp_sl(&direction, limit_price, take_profit_price, stop_loss_price)?;
    }

    let size_usd = (margin_usd as u128)
        .checked_mul(leverage as u128)
        .unwrap() as u64;

    ua.locked_margin_usd = ua.locked_margin_usd.checked_add(margin_usd).unwrap();

    let clock = Clock::get()?;
    let position_id = ua.total_trading_positions;

    pos.owner = ua.owner;
    pos.position_id = position_id;
    pos.market_category = market_category.clone();
    pos.pair_index = pair_index;
    pos.trade_mode = trade_mode.clone();
    pos.direction = direction.clone();
    pos.order_type = OrderType::Limit;
    pos.size_usd = size_usd;
    pos.margin_usd = margin_usd;
    pos.leverage = leverage;
    pos.entry_price = 0;
    pos.limit_price = limit_price;
    pos.take_profit_price = take_profit_price;
    pos.stop_loss_price = stop_loss_price;
    pos.liquidation_price = 0;
    pos.status = PositionStatus::PendingFill;
    pos.opened_at = clock.unix_timestamp;
    pos.filled_at = 0;
    pos.closed_at = 0;
    pos.close_price = 0;
    pos.realized_pnl = 0;
    pos.close_reason = CloseReason::None;
    pos.bump = pos_bump;

    ua.total_trading_positions = ua.total_trading_positions.checked_add(1).unwrap();

    emit!(TradingPositionOpened {
        user: ua.owner,
        position_id,
        market_category,
        pair_index,
        trade_mode,
        direction,
        order_type: OrderType::Limit,
        size_usd,
        margin_usd,
        leverage,
        entry_price: 0,
        limit_price,
        take_profit_price,
        stop_loss_price,
        liquidation_price: 0,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn cancel_limit_inner(ua: &mut UserAccount, pos: &mut TradingPosition) -> Result<()> {
    require!(
        pos.status == PositionStatus::PendingFill,
        ErrorCode::PositionNotPending
    );

    ua.locked_margin_usd = ua.locked_margin_usd.checked_sub(pos.margin_usd).unwrap_or(0);

    let clock = Clock::get()?;
    pos.status = PositionStatus::Cancelled;
    pos.closed_at = clock.unix_timestamp;

    emit!(TradingPositionCancelled {
        user: pos.owner,
        position_id: pos.position_id,
        market_category: pos.market_category.clone(),
        pair_index: pos.pair_index,
        margin_returned: pos.margin_usd,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn fill_limit_inner(pos: &mut TradingPosition, current_price: u64) -> Result<()> {
    require!(pos.status == PositionStatus::PendingFill, ErrorCode::PositionNotPending);
    require!(current_price > 0, ErrorCode::InvalidPrice);

    let fill_condition_met = match pos.direction {
        Direction::Long => current_price <= pos.limit_price,
        Direction::Short => current_price >= pos.limit_price,
    };
    require!(fill_condition_met, ErrorCode::FillConditionNotMet);

    let clock = Clock::get()?;
    pos.entry_price = current_price;
    pos.filled_at = clock.unix_timestamp;
    pos.status = PositionStatus::Active;

    if pos.trade_mode == TradeMode::Perp {
        pos.liquidation_price =
            compute_liquidation_price(current_price, pos.leverage, &pos.direction);
    }

    emit!(LimitOrderFilled {
        user: pos.owner,
        position_id: pos.position_id,
        market_category: pos.market_category.clone(),
        pair_index: pos.pair_index,
        fill_price: current_price,
        liquidation_price: pos.liquidation_price,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn execute_tp_sl_inner(
    ua: &mut UserAccount,
    pos: &mut TradingPosition,
    current_price: u64,
) -> Result<()> {
    require!(pos.status == PositionStatus::Active, ErrorCode::PositionNotActive);
    require!(current_price > 0, ErrorCode::InvalidPrice);

    let close_reason = match pos.direction {
        Direction::Long => {
            if pos.take_profit_price > 0 && current_price >= pos.take_profit_price {
                CloseReason::TakeProfit
            } else if pos.stop_loss_price > 0 && current_price <= pos.stop_loss_price {
                CloseReason::StopLoss
            } else {
                return Err(ErrorCode::ConditionNotMet.into());
            }
        }
        Direction::Short => {
            if pos.take_profit_price > 0 && current_price <= pos.take_profit_price {
                CloseReason::TakeProfit
            } else if pos.stop_loss_price > 0 && current_price >= pos.stop_loss_price {
                CloseReason::StopLoss
            } else {
                return Err(ErrorCode::ConditionNotMet.into());
            }
        }
    };

    settle_trading_position(pos, ua, current_price, close_reason)
}

fn liquidate_inner(
    ua: &mut UserAccount,
    pos: &mut TradingPosition,
    current_price: u64,
) -> Result<()> {
    require!(pos.status == PositionStatus::Active, ErrorCode::PositionNotActive);
    require!(pos.trade_mode == TradeMode::Perp, ErrorCode::NotAPerpPosition);
    require!(current_price > 0, ErrorCode::InvalidPrice);

    let liq_condition_met = match pos.direction {
        Direction::Long => current_price <= pos.liquidation_price,
        Direction::Short => current_price >= pos.liquidation_price,
    };
    require!(liq_condition_met, ErrorCode::LiquidationConditionNotMet);

    settle_trading_position(pos, ua, current_price, CloseReason::Liquidation)
}

#[allow(clippy::too_many_arguments)]
fn open_prediction_inner(
    ua: &mut UserAccount,
    pos: &mut PredictionPosition,
    pos_bump: u8,
    market_id: String,
    amount_usd: u64,
    price_per_share: u64,
    stop_loss: u64,
    take_profit: u64,
    prediction_type: PredictionType,
) -> Result<()> {
    require!(market_id.len() <= 128, ErrorCode::MarketIdTooLong);
    require!(amount_usd > 0, ErrorCode::InvalidMargin);
    require!(
        price_per_share > 0 && price_per_share <= MAX_PREDICTION_PRICE,
        ErrorCode::InvalidPrice
    );

    let available = ua
        .usd_balance
        .checked_sub(ua.locked_margin_usd)
        .ok_or(ErrorCode::InsufficientBalance)?;
    require!(available >= amount_usd, ErrorCode::InsufficientBalance);

    let shares = (amount_usd as u128)
        .checked_mul(PRICE_SCALE)
        .unwrap()
        .checked_div(price_per_share as u128)
        .unwrap() as u64;

    ua.usd_balance = ua.usd_balance.checked_sub(amount_usd).unwrap();

    let clock = Clock::get()?;
    let position_id = ua.total_prediction_positions;

    pos.owner = ua.owner;
    pos.position_id = position_id;
    pos.market_id = market_id.clone();
    pos.prediction_type = prediction_type.clone();
    pos.amount_usd = amount_usd;
    pos.price_per_share = price_per_share;
    pos.shares = shares;
    pos.remaining_shares = shares;
    pos.total_sold_shares = 0;
    pos.average_sell_price = 0;
    pos.status = PredictionStatus::Active;
    pos.opened_at = clock.unix_timestamp;
    pos.closed_at = 0;
    pos.stop_loss = stop_loss;
    pos.take_profit = take_profit;
    pos.bump = pos_bump;

    ua.total_prediction_positions = ua.total_prediction_positions.checked_add(1).unwrap();

    emit!(PredictionOpened {
        user: ua.owner,
        position_id,
        market_id,
        prediction_type,
        amount_usd,
        price_per_share,
        shares,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn sell_prediction_inner(
    ua: &mut UserAccount,
    pos: &mut PredictionPosition,
    shares_to_sell: u64,
    current_price: u64,
    expected_type: PredictionType,
) -> Result<()> {
    require!(
        pos.status == PredictionStatus::Active || pos.status == PredictionStatus::PartiallySold,
        ErrorCode::PositionNotActive
    );
    require!(pos.owner == ua.owner, ErrorCode::Unauthorized);
    require!(pos.prediction_type == expected_type, ErrorCode::WrongPredictionType);
    require!(
        current_price > 0 && current_price <= MAX_PREDICTION_PRICE,
        ErrorCode::InvalidPrice
    );
    require!(
        shares_to_sell > 0 && shares_to_sell <= pos.remaining_shares,
        ErrorCode::InsufficientShares
    );

    let payout = (shares_to_sell as u128)
        .checked_mul(current_price as u128)
        .unwrap()
        .checked_div(PRICE_SCALE)
        .unwrap() as u64;

    ua.usd_balance = ua.usd_balance.checked_add(payout).unwrap();

    let previous_sold_value = (pos.total_sold_shares as u128)
        .checked_mul(pos.average_sell_price as u128)
        .unwrap();
    let new_sold_value = (shares_to_sell as u128)
        .checked_mul(current_price as u128)
        .unwrap();
    let total_sold_shares = pos.total_sold_shares.checked_add(shares_to_sell).unwrap();
    let new_avg = previous_sold_value
        .checked_add(new_sold_value)
        .unwrap()
        .checked_div(total_sold_shares as u128)
        .unwrap() as u64;

    pos.remaining_shares = pos.remaining_shares.checked_sub(shares_to_sell).unwrap();
    pos.total_sold_shares = total_sold_shares;
    pos.average_sell_price = new_avg;

    let clock = Clock::get()?;
    if pos.remaining_shares == 0 {
        pos.status = PredictionStatus::FullySold;
        pos.closed_at = clock.unix_timestamp;
    } else {
        pos.status = PredictionStatus::PartiallySold;
    }

    emit!(PredictionSharesSold {
        user: pos.owner,
        position_id: pos.position_id,
        market_id: pos.market_id.clone(),
        prediction_type: pos.prediction_type.clone(),
        shares_sold: shares_to_sell,
        sell_price: current_price,
        payout,
        remaining_shares: pos.remaining_shares,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn close_prediction_inner(
    ua: &mut UserAccount,
    pos: &mut PredictionPosition,
    current_price: u64,
) -> Result<()> {
    require!(
        pos.status == PredictionStatus::Active
            || pos.status == PredictionStatus::PartiallySold,
        ErrorCode::PositionNotActive
    );
    require!(pos.owner == ua.owner, ErrorCode::Unauthorized);
    require!(current_price <= MAX_PREDICTION_PRICE, ErrorCode::InvalidPrice);

    let remaining = pos.remaining_shares;
    require!(remaining > 0, ErrorCode::InsufficientShares);

    let payout = (remaining as u128)
        .checked_mul(current_price as u128)
        .unwrap()
        .checked_div(PRICE_SCALE)
        .unwrap() as u64;

    ua.usd_balance = ua.usd_balance.checked_add(payout).unwrap();

    let clock = Clock::get()?;
    pos.remaining_shares = 0;
    pos.total_sold_shares = pos.total_sold_shares.checked_add(remaining).unwrap();
    pos.status = PredictionStatus::Closed;
    pos.closed_at = clock.unix_timestamp;

    emit!(PredictionClosed {
        user: pos.owner,
        position_id: pos.position_id,
        market_id: pos.market_id.clone(),
        close_price: current_price,
        payout,
        reason: "Manual".to_string(),
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn close_prediction_auto_inner(
    ua: &mut UserAccount,
    pos: &mut PredictionPosition,
    current_price: u64,
) -> Result<()> {
    require!(pos.status == PredictionStatus::Active, ErrorCode::PositionNotActive);
    require!(
        current_price > 0 && current_price <= MAX_PREDICTION_PRICE,
        ErrorCode::InvalidPrice
    );

    let sl_hit = pos.stop_loss > 0 && current_price <= pos.stop_loss;
    let tp_hit = pos.take_profit > 0 && current_price >= pos.take_profit;
    require!(sl_hit || tp_hit, ErrorCode::ConditionNotMet);

    let remaining = pos.remaining_shares;
    let payout = (remaining as u128)
        .checked_mul(current_price as u128)
        .unwrap()
        .checked_div(PRICE_SCALE)
        .unwrap() as u64;

    ua.usd_balance = ua.usd_balance.checked_add(payout).unwrap();

    let clock = Clock::get()?;
    pos.remaining_shares = 0;
    pos.total_sold_shares = pos.total_sold_shares.checked_add(remaining).unwrap();
    pos.status = PredictionStatus::Closed;
    pos.closed_at = clock.unix_timestamp;

    emit!(PredictionClosed {
        user: pos.owner,
        position_id: pos.position_id,
        market_id: pos.market_id.clone(),
        close_price: current_price,
        payout,
        reason: if sl_hit { "StopLoss".to_string() } else { "TakeProfit".to_string() },
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}

fn require_competition_active(comp: &Competition) -> Result<()> {
    require!(
        comp.status == CompetitionStatus::Active,
        ErrorCode::CompetitionNotActive
    );
    let now = Clock::get()?.unix_timestamp;
    require!(now < comp.end_ts, ErrorCode::CompetitionEnded);
    Ok(())
}

/// Insert `(participant, balance)` into the top-3 leaderboard if it ranks.
/// Empty slots have `participant == Pubkey::default()`. Updates an existing
/// entry in place if the participant already appears (so resubmissions don't
/// duplicate). Returns true if the leaderboard was modified.
fn update_top3(top: &mut [LeaderEntry; 3], participant: Pubkey, balance: u64) -> bool {
    for entry in top.iter_mut() {
        if entry.participant == participant {
            if balance == entry.balance {
                return false;
            }
            entry.balance = balance;
            top.sort_by(|a, b| b.balance.cmp(&a.balance));
            return true;
        }
    }
    let weakest_idx = top
        .iter()
        .enumerate()
        .min_by_key(|(_, e)| {
            if e.participant == Pubkey::default() {
                0
            } else {
                e.balance
            }
        })
        .map(|(i, _)| i)
        .unwrap_or(2);
    let weakest = &top[weakest_idx];
    let qualifies = weakest.participant == Pubkey::default() || balance > weakest.balance;
    if !qualifies {
        return false;
    }
    top[weakest_idx] = LeaderEntry { participant, balance };
    top.sort_by(|a, b| b.balance.cmp(&a.balance));
    true
}

fn validate_leverage(trade_mode: &TradeMode, leverage: u8) -> Result<()> {
    match trade_mode {
        TradeMode::Spot => require!(leverage == 1, ErrorCode::InvalidLeverage),
        TradeMode::Perp => {
            let valid = matches!(leverage, 2 | 3 | 5 | 10 | 15 | 20 | 25 | 50);
            require!(valid, ErrorCode::InvalidLeverage);
        }
    }
    Ok(())
}

fn validate_tp_sl(
    direction: &Direction,
    ref_price: u64,
    take_profit_price: u64,
    stop_loss_price: u64,
) -> Result<()> {
    match direction {
        Direction::Long => {
            if take_profit_price > 0 {
                require!(take_profit_price > ref_price, ErrorCode::InvalidTakeProfitPrice);
            }
            if stop_loss_price > 0 {
                require!(stop_loss_price < ref_price, ErrorCode::InvalidStopLossPrice);
            }
        }
        Direction::Short => {
            if take_profit_price > 0 {
                require!(take_profit_price < ref_price, ErrorCode::InvalidTakeProfitPrice);
            }
            if stop_loss_price > 0 {
                require!(stop_loss_price > ref_price, ErrorCode::InvalidStopLossPrice);
            }
        }
    }
    Ok(())
}

fn compute_liquidation_price(entry_price: u64, leverage: u8, direction: &Direction) -> u64 {
    let lev = leverage as u128;
    let entry = entry_price as u128;
    let denom = lev * 10_000;

    match direction {
        Direction::Long => {
            let numerator = lev * 10_000 - 10_000 + MAINTENANCE_MARGIN_BPS;
            (entry * numerator / denom) as u64
        }
        Direction::Short => {
            let numerator = lev * 10_000 + 10_000 - MAINTENANCE_MARGIN_BPS;
            (entry * numerator / denom) as u64
        }
    }
}

fn compute_pnl(
    direction: &Direction,
    size_usd: u64,
    entry_price: u64,
    close_price: u64,
) -> i64 {
    let size = size_usd as u128;
    let entry = entry_price as u128;
    let close = close_price as u128;

    match direction {
        Direction::Long => {
            if close >= entry {
                let profit = size * (close - entry) / entry;
                profit.min(i64::MAX as u128) as i64
            } else {
                let loss = size * (entry - close) / entry;
                -(loss.min(i64::MAX as u128) as i64)
            }
        }
        Direction::Short => {
            if entry >= close {
                let profit = size * (entry - close) / entry;
                profit.min(i64::MAX as u128) as i64
            } else {
                let loss = size * (close - entry) / entry;
                -(loss.min(i64::MAX as u128) as i64)
            }
        }
    }
}

fn settle_trading_position(
    pos: &mut TradingPosition,
    ua: &mut UserAccount,
    close_price: u64,
    close_reason: CloseReason,
) -> Result<()> {
    let pnl = compute_pnl(&pos.direction, pos.size_usd, pos.entry_price, close_price);

    let returned_usd = ((pos.margin_usd as i64).checked_add(pnl).unwrap_or(0)).max(0) as u64;

    ua.locked_margin_usd = ua.locked_margin_usd.checked_sub(pos.margin_usd).unwrap_or(0);
    ua.usd_balance = ua
        .usd_balance
        .checked_sub(pos.margin_usd)
        .unwrap_or(0)
        .checked_add(returned_usd)
        .unwrap_or(ua.usd_balance);

    let clock = Clock::get()?;
    pos.status = match close_reason {
        CloseReason::Liquidation => PositionStatus::Liquidated,
        _ => PositionStatus::Closed,
    };
    pos.close_price = close_price;
    pos.realized_pnl = pnl;
    pos.close_reason = close_reason.clone();
    pos.closed_at = clock.unix_timestamp;

    emit!(TradingPositionClosed {
        user: pos.owner,
        position_id: pos.position_id,
        market_category: pos.market_category.clone(),
        pair_index: pos.pair_index,
        trade_mode: pos.trade_mode.clone(),
        direction: pos.direction.clone(),
        size_usd: pos.size_usd,
        margin_usd: pos.margin_usd,
        entry_price: pos.entry_price,
        close_price,
        realized_pnl: pnl,
        close_reason,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ============= CONTEXTS =============

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 4 + (32 * 10) + 1,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateExecutors<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, ProgramConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeUserAccount<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"user", user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: Validated against config.treasury
    #[account(mut, constraint = treasury.key() == config.treasury)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct OpenTradingPositionCtx<'info> {
    #[account(
        mut,
        seeds = [b"user", user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + TradingPosition::INIT_SPACE,
        seeds = [
            b"trade",
            user_account.key().as_ref(),
            user_account.total_trading_positions.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub position: Account<'info, TradingPosition>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct UserTradingAction<'info> {
    #[account(
        mut,
        seeds = [b"user", user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        mut,
        seeds = [
            b"trade",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump,
        constraint = position.owner == user_account.owner @ ErrorCode::Unauthorized
    )]
    pub position: Account<'info, TradingPosition>,
    pub user: Signer<'info>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct ExecutorTradingAction<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [
            b"trade",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump
    )]
    pub position: Account<'info, TradingPosition>,
    #[account(
        mut,
        seeds = [b"user", position.owner.as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,
    pub executor: Signer<'info>,
}

#[derive(Accounts, Session)]
#[instruction(market_id: String)]
pub struct OpenPredictionCtx<'info> {
    #[account(
        mut,
        seeds = [b"user", user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + PredictionPosition::INIT_SPACE,
        seeds = [
            b"pred",
            user_account.key().as_ref(),
            user_account.total_prediction_positions.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub position: Account<'info, PredictionPosition>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct SellPredictionCtx<'info> {
    #[account(
        mut,
        seeds = [b"user", user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        mut,
        seeds = [
            b"pred",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump,
        constraint = position.owner == user_account.owner @ ErrorCode::Unauthorized
    )]
    pub position: Account<'info, PredictionPosition>,
    pub user: Signer<'info>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct ExecutorPredictionAction<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [
            b"pred",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump
    )]
    pub position: Account<'info, PredictionPosition>,
    #[account(
        mut,
        seeds = [b"user", position.owner.as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,
    pub executor: Signer<'info>,
}

// ─── Competition contexts ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct MigrateUserAccount<'info> {
    /// CHECK: deserialized as raw bytes because the on-chain layout may
    /// predate the `active_competition` field. Validated via the seeds
    /// constraint, which proves the account is the user's own UserAccount PDA.
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump,
    )]
    pub user_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateCompetition<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Competition::INIT_SPACE,
        seeds = [b"comp", creator.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub competition: Account<'info, Competition>,
    /// SOL escrow PDA. System-owned account; rent-exempt deposit happens
    /// via `system_program::transfer` on first join.
    /// CHECK: PDA derived from `[b"comp_vault", competition]`. No data, just lamports.
    #[account(
        seeds = [b"comp_vault", competition.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinCompetition<'info> {
    #[account(
        mut,
        seeds = [b"comp", competition.creator.as_ref(), competition.name[..competition.name_len as usize].as_ref()],
        bump = competition.bump,
    )]
    pub competition: Account<'info, Competition>,
    /// CHECK: PDA derived from `[b"comp_vault", competition]`.
    #[account(
        mut,
        seeds = [b"comp_vault", competition.key().as_ref()],
        bump = competition.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"comp_user", competition.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub comp_user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReportScore<'info> {
    #[account(
        mut,
        seeds = [b"comp", competition.creator.as_ref(), competition.name[..competition.name_len as usize].as_ref()],
        bump = competition.bump,
    )]
    pub competition: Account<'info, Competition>,
    #[account(
        seeds = [b"comp_user", competition.key().as_ref(), comp_user_account.owner.as_ref()],
        bump = comp_user_account.bump,
    )]
    pub comp_user_account: Account<'info, UserAccount>,
    /// Permissionless caller — pays the tx fee.
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleCompetition<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [b"comp", competition.creator.as_ref(), competition.name[..competition.name_len as usize].as_ref()],
        bump = competition.bump,
    )]
    pub competition: Account<'info, Competition>,
    /// CHECK: PDA derived from `[b"comp_vault", competition]`. Source of payouts.
    #[account(
        mut,
        seeds = [b"comp_vault", competition.key().as_ref()],
        bump = competition.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    /// CHECK: First-place wallet (matched against `competition.top[0].participant`).
    #[account(mut)]
    pub first_place: SystemAccount<'info>,
    /// CHECK: Second-place wallet.
    #[account(mut)]
    pub second_place: SystemAccount<'info>,
    /// CHECK: Third-place wallet.
    #[account(mut)]
    pub third_place: SystemAccount<'info>,
    /// CHECK: Validated against `config.treasury`.
    #[account(mut, constraint = treasury.key() == config.treasury @ ErrorCode::InvalidTreasuryAccount)]
    pub treasury: SystemAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimCompetitionExit<'info> {
    #[account(
        seeds = [b"comp", competition.creator.as_ref(), competition.name[..competition.name_len as usize].as_ref()],
        bump = competition.bump,
    )]
    pub competition: Account<'info, Competition>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
        has_one = owner @ ErrorCode::Unauthorized,
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: matched via `has_one = owner` against user_account.
    #[account(address = user_account.owner)]
    pub owner: SystemAccount<'info>,
    pub user: Signer<'info>,
}

#[derive(Accounts, Session)]
pub struct CompOpenTradingPositionCtx<'info> {
    #[account(
        seeds = [b"comp", competition.creator.as_ref(), competition.name[..competition.name_len as usize].as_ref()],
        bump = competition.bump,
    )]
    pub competition: Account<'info, Competition>,
    #[account(
        mut,
        seeds = [b"comp_user", competition.key().as_ref(), user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + TradingPosition::INIT_SPACE,
        seeds = [
            b"trade",
            user_account.key().as_ref(),
            user_account.total_trading_positions.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub position: Account<'info, TradingPosition>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct CompUserTradingAction<'info> {
    #[account(
        mut,
        seeds = [b"comp_user", user_account.active_competition.as_ref(), user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        mut,
        seeds = [
            b"trade",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump,
        constraint = position.owner == user_account.owner @ ErrorCode::Unauthorized
    )]
    pub position: Account<'info, TradingPosition>,
    pub user: Signer<'info>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct CompExecutorTradingAction<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [
            b"trade",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump
    )]
    pub position: Account<'info, TradingPosition>,
    #[account(
        mut,
        seeds = [b"comp_user", user_account.active_competition.as_ref(), position.owner.as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == position.owner @ ErrorCode::Unauthorized
    )]
    pub user_account: Account<'info, UserAccount>,
    pub executor: Signer<'info>,
}

#[derive(Accounts, Session)]
#[instruction(market_id: String)]
pub struct CompOpenPredictionCtx<'info> {
    #[account(
        seeds = [b"comp", competition.creator.as_ref(), competition.name[..competition.name_len as usize].as_ref()],
        bump = competition.bump,
    )]
    pub competition: Account<'info, Competition>,
    #[account(
        mut,
        seeds = [b"comp_user", competition.key().as_ref(), user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + PredictionPosition::INIT_SPACE,
        seeds = [
            b"pred",
            user_account.key().as_ref(),
            user_account.total_prediction_positions.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub position: Account<'info, PredictionPosition>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct CompSellPredictionCtx<'info> {
    #[account(
        mut,
        seeds = [b"comp_user", user_account.active_competition.as_ref(), user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        mut,
        seeds = [
            b"pred",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump,
        constraint = position.owner == user_account.owner @ ErrorCode::Unauthorized
    )]
    pub position: Account<'info, PredictionPosition>,
    pub user: Signer<'info>,
    #[session(signer = user, authority = user_account.owner.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct CompExecutorPredictionAction<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [
            b"pred",
            user_account.key().as_ref(),
            position.position_id.to_le_bytes().as_ref()
        ],
        bump = position.bump
    )]
    pub position: Account<'info, PredictionPosition>,
    #[account(
        mut,
        seeds = [b"comp_user", user_account.active_competition.as_ref(), position.owner.as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == position.owner @ ErrorCode::Unauthorized
    )]
    pub user_account: Account<'info, UserAccount>,
    pub executor: Signer<'info>,
}

// ============= EVENTS =============

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct ExecutorAdded {
    pub executor: Pubkey,
}

#[event]
pub struct ExecutorRemoved {
    pub executor: Pubkey,
}

#[event]
pub struct AccountInitialized {
    pub user: Pubkey,
    pub initial_balance: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradingPositionOpened {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_category: MarketCategory,
    pub pair_index: u8,
    pub trade_mode: TradeMode,
    pub direction: Direction,
    pub order_type: OrderType,
    pub size_usd: u64,
    pub margin_usd: u64,
    pub leverage: u8,
    pub entry_price: u64,
    pub limit_price: u64,
    pub take_profit_price: u64,
    pub stop_loss_price: u64,
    pub liquidation_price: u64,
    pub timestamp: i64,
}

#[event]
pub struct LimitOrderFilled {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_category: MarketCategory,
    pub pair_index: u8,
    pub fill_price: u64,
    pub liquidation_price: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradingPositionClosed {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_category: MarketCategory,
    pub pair_index: u8,
    pub trade_mode: TradeMode,
    pub direction: Direction,
    pub size_usd: u64,
    pub margin_usd: u64,
    pub entry_price: u64,
    pub close_price: u64,
    pub realized_pnl: i64,
    pub close_reason: CloseReason,
    pub timestamp: i64,
}

#[event]
pub struct TradingPositionCancelled {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_category: MarketCategory,
    pub pair_index: u8,
    pub margin_returned: u64,
    pub timestamp: i64,
}

#[event]
pub struct PredictionOpened {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_id: String,
    pub prediction_type: PredictionType,
    pub amount_usd: u64,
    pub price_per_share: u64,
    pub shares: u64,
    pub timestamp: i64,
}

#[event]
pub struct PredictionSharesSold {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_id: String,
    pub prediction_type: PredictionType,
    pub shares_sold: u64,
    pub sell_price: u64,
    pub payout: u64,
    pub remaining_shares: u64,
    pub timestamp: i64,
}

#[event]
pub struct PredictionClosed {
    pub user: Pubkey,
    pub position_id: u64,
    pub market_id: String,
    pub close_price: u64,
    pub payout: u64,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct CompetitionCreated {
    pub competition: Pubkey,
    pub creator: Pubkey,
    pub entry_ticket_lamports: u64,
    pub target_lamports: u64,
    pub duration_secs: i64,
    pub max_participants: u64,
    pub timestamp: i64,
}

#[event]
pub struct CompetitionJoined {
    pub competition: Pubkey,
    pub participant: Pubkey,
    pub participant_count: u64,
    pub prize_pool: u64,
    pub timestamp: i64,
}

#[event]
pub struct CompetitionStarted {
    pub competition: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub participant_count: u64,
    pub prize_pool: u64,
}

#[event]
pub struct ScoreReported {
    pub competition: Pubkey,
    pub participant: Pubkey,
    pub balance: u64,
    pub top: [LeaderEntry; 3],
}

#[event]
pub struct CompetitionSettled {
    pub competition: Pubkey,
    pub first: Pubkey,
    pub first_amount: u64,
    pub second: Pubkey,
    pub second_amount: u64,
    pub third: Pubkey,
    pub third_amount: u64,
    pub treasury_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct CompetitionExitClaimed {
    pub competition: Pubkey,
    pub participant: Pubkey,
}

// ============= ERRORS =============

#[error_code]
pub enum ErrorCode {
    #[msg("Entry fee is too low (minimum 0.1 SOL)")]
    EntryFeeTooLow,

    #[msg("Insufficient available balance")]
    InsufficientBalance,

    #[msg("Margin/amount must be greater than zero")]
    InvalidMargin,

    #[msg("Price must be greater than zero")]
    InvalidPrice,

    #[msg("Limit price must be greater than zero")]
    InvalidLimitPrice,

    #[msg("Invalid take profit price for this direction")]
    InvalidTakeProfitPrice,

    #[msg("Invalid stop loss price for this direction")]
    InvalidStopLossPrice,

    #[msg("Invalid leverage — spot must be 1x; perp tiers: 2,3,5,10,15,20,25,50")]
    InvalidLeverage,

    #[msg("Position is not active")]
    PositionNotActive,

    #[msg("Position is not in PendingFill status")]
    PositionNotPending,

    #[msg("TP/SL condition not met at current price")]
    ConditionNotMet,

    #[msg("Fill condition not met at current price")]
    FillConditionNotMet,

    #[msg("Liquidation condition not met at current price")]
    LiquidationConditionNotMet,

    #[msg("This position is not a perp — cannot liquidate")]
    NotAPerpPosition,

    #[msg("Unauthorized access")]
    Unauthorized,

    #[msg("Executor is not in the authorized whitelist")]
    UnauthorizedExecutor,

    #[msg("Executor already exists in the whitelist")]
    ExecutorAlreadyExists,

    #[msg("Insufficient shares to sell")]
    InsufficientShares,

    #[msg("Wrong prediction type for this operation")]
    WrongPredictionType,

    #[msg("Market id exceeds maximum length of 128 chars")]
    MarketIdTooLong,

    #[msg("Competition name must be 1..=32 bytes")]
    CompetitionNameInvalid,

    #[msg("Entry ticket must be greater than zero")]
    InvalidEntryTicket,

    #[msg("Target allocation must be a multiple of the entry ticket and allow at least 3 participants")]
    InvalidTargetAllocation,

    #[msg("Competition duration must be between 3 and 21 days")]
    InvalidCompetitionDuration,

    #[msg("Competition is not accepting joiners")]
    CompetitionNotJoinable,

    #[msg("Competition is full")]
    CompetitionFull,

    #[msg("User is already in another competition")]
    AlreadyInCompetition,

    #[msg("Competition is not active")]
    CompetitionNotActive,

    #[msg("Competition has ended")]
    CompetitionEnded,

    #[msg("Competition has not yet ended")]
    CompetitionNotEnded,

    #[msg("Competition has not been settled")]
    CompetitionNotSettled,

    #[msg("User account is not in this competition")]
    NotInThisCompetition,

    #[msg("Provided podium account does not match the leaderboard cache")]
    PodiumAccountMismatch,

    #[msg("Treasury account does not match config")]
    InvalidTreasuryAccount,

    #[msg("Prize pool arithmetic overflow")]
    PrizePoolMath,
}
