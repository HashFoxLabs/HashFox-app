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
        validate_leverage(&trade_mode, leverage)?;
        require!(margin_usd > 0, ErrorCode::InvalidMargin);
        require!(entry_price > 0, ErrorCode::InvalidPrice);

        let ua = &mut ctx.accounts.user_account;
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
        let pos = &mut ctx.accounts.position;

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
        pos.bump = ctx.bumps.position;

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
        validate_leverage(&trade_mode, leverage)?;
        require!(margin_usd > 0, ErrorCode::InvalidMargin);
        require!(limit_price > 0, ErrorCode::InvalidLimitPrice);

        let ua = &mut ctx.accounts.user_account;
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
        let pos = &mut ctx.accounts.position;

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
        pos.bump = ctx.bumps.position;

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

    /// Cancel a pending limit order. Returns locked margin to available balance.
    #[session_auth_or(
        ctx.accounts.user_account.owner == ctx.accounts.user.key(),
        SessionError::InvalidToken
    )]
    pub fn cancel_limit_order(ctx: Context<UserTradingAction>) -> Result<()> {
        let pos = &mut ctx.accounts.position;
        let ua = &mut ctx.accounts.user_account;

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
        require!(
            ctx.accounts
                .config
                .authorized_executors
                .contains(&ctx.accounts.executor.key()),
            ErrorCode::UnauthorizedExecutor
        );

        let pos = &mut ctx.accounts.position;
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

    pub fn execute_tp_sl(ctx: Context<ExecutorTradingAction>, current_price: u64) -> Result<()> {
        require!(
            ctx.accounts
                .config
                .authorized_executors
                .contains(&ctx.accounts.executor.key()),
            ErrorCode::UnauthorizedExecutor
        );

        let pos = &mut ctx.accounts.position;
        let ua = &mut ctx.accounts.user_account;

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

        settle_trading_position(pos, ua, current_price, close_reason)?;
        Ok(())
    }

    pub fn liquidate_position(ctx: Context<ExecutorTradingAction>, current_price: u64) -> Result<()> {
        require!(
            ctx.accounts
                .config
                .authorized_executors
                .contains(&ctx.accounts.executor.key()),
            ErrorCode::UnauthorizedExecutor
        );

        let pos = &mut ctx.accounts.position;
        let ua = &mut ctx.accounts.user_account;

        require!(pos.status == PositionStatus::Active, ErrorCode::PositionNotActive);
        require!(pos.trade_mode == TradeMode::Perp, ErrorCode::NotAPerpPosition);
        require!(current_price > 0, ErrorCode::InvalidPrice);

        let liq_condition_met = match pos.direction {
            Direction::Long => current_price <= pos.liquidation_price,
            Direction::Short => current_price >= pos.liquidation_price,
        };
        require!(liq_condition_met, ErrorCode::LiquidationConditionNotMet);

        settle_trading_position(pos, ua, current_price, CloseReason::Liquidation)?;
        Ok(())
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
        open_prediction(
            ctx,
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
        open_prediction(
            ctx,
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
        sell_prediction(ctx, shares_to_sell, current_price, PredictionType::Yes)
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
        sell_prediction(ctx, shares_to_sell, current_price, PredictionType::No)
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
        let ua = &mut ctx.accounts.user_account;
        let pos = &mut ctx.accounts.position;

        require!(
            pos.status == PredictionStatus::Active
                || pos.status == PredictionStatus::PartiallySold,
            ErrorCode::PositionNotActive
        );
        require!(pos.owner == ua.owner, ErrorCode::Unauthorized);
        require!(
            current_price <= MAX_PREDICTION_PRICE,
            ErrorCode::InvalidPrice
        );

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

    /// Executor-only auto-close when SL or TP is met on a prediction position.
    pub fn close_prediction_auto(
        ctx: Context<ExecutorPredictionAction>,
        current_price: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts
                .config
                .authorized_executors
                .contains(&ctx.accounts.executor.key()),
            ErrorCode::UnauthorizedExecutor
        );

        let ua = &mut ctx.accounts.user_account;
        let pos = &mut ctx.accounts.position;

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
}

// ============= INTERNAL HELPERS =============

fn open_prediction(
    ctx: Context<OpenPredictionCtx>,
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

    let ua = &mut ctx.accounts.user_account;
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
    let pos = &mut ctx.accounts.position;

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
    pos.bump = ctx.bumps.position;

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

fn sell_prediction(
    ctx: Context<SellPredictionCtx>,
    shares_to_sell: u64,
    current_price: u64,
    expected_type: PredictionType,
) -> Result<()> {
    let ua = &mut ctx.accounts.user_account;
    let pos = &mut ctx.accounts.position;

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
            user_account.owner.as_ref(),
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
            user_account.owner.as_ref(),
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
            position.owner.as_ref(),
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
            user_account.owner.as_ref(),
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
            user_account.owner.as_ref(),
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
            position.owner.as_ref(),
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
}
