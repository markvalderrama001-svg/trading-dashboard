/**
 * All user-tunable settings. Edit here. Nothing else needs to change.
 * See README "Adding or removing watchlist tickers".
 */

/** Panel 2: wheel radar. Add or remove tickers freely. */
export const WHEEL_WATCHLIST = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL",
  "META", "JPM", "BAC", "KO", "PEP",
  "XOM", "CVX", "UNH", "JNJ", "WMT",
  "HD", "DIS", "INTC", "F", "T",
] as const;

/**
 * Panel 1 sub-section: LEAPs to track by underlying.
 * Listed here regardless of whether the account currently holds them. An
 * entry with no matching position renders as "not in account" rather than
 * disappearing silently.
 */
export const TRACKED_LEAPS = ["NVDA", "MSFT"] as const;

/** Trading rules the panels flag against. */
export const RULES = {
  /** Close a short option once this fraction of max profit is captured. */
  profitTargetPct: 50,
  /** Days-to-expiry below which a position is flagged for management. */
  dteWarning: 21,
  /** Target cash as a share of net liquidating value. */
  cashTargetPct: 25,
} as const;

/** Panel 3 regime thresholds. */
export const VIX_BANDS = {
  calm: 17,
  elevated: 25,
} as const;

/** Auto-refresh intervals, in milliseconds. */
export const REFRESH_MS = {
  market: 5 * 60_000,
  account: 15 * 60_000,
  news: 10 * 60_000,
} as const;

/** localStorage key prefix for the last-good cache. */
export const CACHE_PREFIX = "td:v1:";
