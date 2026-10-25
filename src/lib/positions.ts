/**
 * Position parsing, P/L, and strategy classification.
 *
 * TastyTrade returns OCC-style symbols: a 6-char space-padded root, YYMMDD,
 * C or P, then the strike as an 8-digit integer of thousandths.
 *   "IREN  260814C00055000" -> IREN, 2026-08-14, call, $55.00
 *
 * `get_positions` carries avg_price but no mark; `get_position_greeks` carries
 * mark but no cost basis. P/L needs both, joined on symbol.
 */

import { RULES, TRACKED_LEAPS } from "../config";

export interface RawPosition {
  symbol: string;
  quantity: number;
  direction: "Long" | "Short" | string;
  type: string;
  avg_price: string;
}

export interface RawGreek {
  symbol: string;
  direction: string;
  quantity: number;
  delta?: number;
  position_delta?: number;
  position_theta?: number;
  position_vega?: number;
  mark?: number;
}

export type Strategy = "CSP" | "Covered Call" | "Spread" | "LEAP" | "Long Call" | "Long Put" | "Stock";

export interface Position {
  symbol: string;
  underlying: string;
  isOption: boolean;
  right: "C" | "P" | null;
  strike: number | null;
  /**
   * Date when freshly built, an ISO string once it has been through the
   * localStorage cache. Render via dateShort(), which handles both.
   */
  expiry: Date | string | null;
  dte: number | null;
  quantity: number;
  isShort: boolean;
  avgPrice: number;
  mark: number | null;
  /** Dollar P/L. Positive is gain, in the direction the position was opened. */
  pnl: number | null;
  pnlPct: number | null;
  /**
   * For short options only: fraction of the opening credit already captured.
   * 100 means the option is worthless and the full credit is kept.
   */
  profitCapturedPct: number | null;
  strategy: Strategy;
  /** Set when profitCapturedPct meets the close rule. */
  atProfitTarget: boolean;
  /** Set when dte is at or under the warning threshold. */
  nearExpiry: boolean;
  theta: number | null;
  delta: number | null;
}

const OCC = /^([A-Z.]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseSymbol(symbol: string) {
  const compact = symbol.trim().replace(/\s+/g, " ");
  const m = compact.replace(/\s/g, "").match(OCC);
  if (!m) return { underlying: compact.split(" ")[0], isOption: false, right: null, strike: null, expiry: null };

  const [, root, yy, mm, dd, right, strikeRaw] = m;
  // OCC years are 2-digit; these contracts are all 21st century.
  const expiry = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), 21, 0, 0));
  return {
    underlying: root,
    isOption: true,
    right: right as "C" | "P",
    strike: Number(strikeRaw) / 1000,
    expiry,
  };
}

export function daysToExpiry(expiry: Date | null, now = new Date()): number | null {
  if (!expiry) return null;
  return Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
}

/**
 * A long call counts as a LEAP past this much remaining life. Deliberately
 * well under a year: we only ever see time *remaining*, so a LEAP opened long
 * ago has already burned most of its original term. Anything on the
 * TRACKED_LEAPS list is treated as a LEAP regardless of remaining DTE.
 */
const LEAP_DTE = 120;

/**
 * Decide which option legs belong to a vertical spread.
 *
 * Sharing underlying + expiry + right isn't sufficient: a book can hold a
 * 275/250 credit spread and a separate naked 330 put at the same expiry, and
 * a naive "more than one leg" test labels all three a spread. So pair each
 * long leg against the nearest-strike opposing short leg, consuming quantity
 * as it goes. Legs left unpaired are standalone.
 *
 * Returns the set of symbols that ended up inside a pair.
 */
function findSpreadLegs(
  legs: { symbol: string; underlying: string; expiryKey: string; right: string | null; strike: number | null; qty: number; isShort: boolean }[],
): Set<string> {
  const inSpread = new Set<string>();
  const groups = new Map<string, typeof legs>();

  for (const leg of legs) {
    if (!leg.right || leg.strike === null) continue;
    const key = `${leg.underlying}|${leg.expiryKey}|${leg.right}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(leg);
  }

  for (const group of groups.values()) {
    const longs = group.filter((l) => !l.isShort).map((l) => ({ ...l, left: l.qty }));
    const shorts = group.filter((l) => l.isShort).map((l) => ({ ...l, left: l.qty }));
    if (!longs.length || !shorts.length) continue;

    for (const long of longs) {
      while (long.left > 0) {
        const candidates = shorts.filter((s) => s.left > 0);
        if (!candidates.length) break;
        // Nearest strike is the conventional vertical pairing.
        const match = candidates.reduce((best, s) =>
          Math.abs(s.strike! - long.strike!) < Math.abs(best.strike! - long.strike!) ? s : best,
        );
        const paired = Math.min(long.left, match.left);
        long.left -= paired;
        match.left -= paired;
        inSpread.add(long.symbol);
        inSpread.add(match.symbol);
      }
    }
  }
  return inSpread;
}

/**
 * Classify each position in the context of the whole book. Covered calls and
 * spreads are only identifiable by what else is held in the same underlying.
 *
 * `stockMarks` supplies last-trade prices for equity positions; TastyTrade's
 * greeks payload only carries marks for options, so without it stock rows show
 * no P/L.
 */
export function buildPositions(
  raw: RawPosition[],
  greeks: RawGreek[],
  now = new Date(),
  stockMarks: Map<string, number> = new Map(),
): Position[] {
  const markBySymbol = new Map<string, RawGreek>();
  for (const g of greeks) markBySymbol.set(g.symbol.replace(/\s+/g, " ").trim(), g);

  const parsed = raw.map((p) => {
    const meta = parseSymbol(p.symbol);
    const g = markBySymbol.get(p.symbol.replace(/\s+/g, " ").trim());
    const isShort = p.direction === "Short";
    const avgPrice = Number(p.avg_price);
    // Guarded on isOption: an option missing its greek must not silently
    // inherit the underlying's share price as a mark.
    const mark =
      typeof g?.mark === "number"
        ? g.mark
        : meta.isOption
          ? null
          : (stockMarks.get(meta.underlying) ?? null);
    const qty = Math.abs(p.quantity);
    const expiry = meta.expiry;

    return {
      raw: p,
      meta,
      g,
      isShort,
      avgPrice,
      mark,
      qty,
      expiry,
      dte: daysToExpiry(expiry, now),
    };
  });

  // Shares held per underlying, needed to tell a covered call from a naked one.
  const sharesByUnderlying = new Map<string, number>();
  for (const p of parsed) {
    if (!p.meta.isOption && p.raw.type === "Equity") {
      const dir = p.raw.direction === "Short" ? -1 : 1;
      sharesByUnderlying.set(
        p.meta.underlying,
        (sharesByUnderlying.get(p.meta.underlying) ?? 0) + dir * p.qty,
      );
    }
  }

  const spreadLegs = findSpreadLegs(
    parsed
      .filter((p) => p.meta.isOption)
      .map((p) => ({
        symbol: p.raw.symbol,
        underlying: p.meta.underlying,
        expiryKey: p.expiry ? p.expiry.toISOString().slice(0, 10) : "",
        right: p.meta.right,
        strike: p.meta.strike,
        qty: p.qty,
        isShort: p.isShort,
      })),
  );

  return parsed.map((p): Position => {
    const { meta, raw: r, isShort, avgPrice, mark, qty, dte } = p;

    let pnl: number | null = null;
    let pnlPct: number | null = null;
    let profitCapturedPct: number | null = null;

    if (mark !== null && Number.isFinite(avgPrice)) {
      const multiplier = meta.isOption ? 100 : 1;
      const perUnit = isShort ? avgPrice - mark : mark - avgPrice;
      pnl = perUnit * qty * multiplier;
      pnlPct = avgPrice !== 0 ? (perUnit / avgPrice) * 100 : null;
      // Max profit on a short option is the full credit, so captured % == pnlPct.
      if (isShort && meta.isOption && avgPrice > 0) {
        profitCapturedPct = ((avgPrice - mark) / avgPrice) * 100;
      }
    }

    let strategy: Strategy;
    if (!meta.isOption) {
      strategy = "Stock";
    } else {
      const covered = (sharesByUnderlying.get(meta.underlying) ?? 0) >= qty * 100;
      // TRACKED_LEAPS is the user's own declaration and outranks the DTE guess.
      const declaredLeap = (TRACKED_LEAPS as readonly string[]).includes(meta.underlying);

      if (spreadLegs.has(r.symbol)) strategy = "Spread";
      else if (isShort && meta.right === "P") strategy = "CSP";
      else if (isShort && meta.right === "C") strategy = covered ? "Covered Call" : "Long Call";
      else if (!isShort && meta.right === "C")
        strategy = declaredLeap || (dte ?? 0) > LEAP_DTE ? "LEAP" : "Long Call";
      else strategy = "Long Put";
    }

    return {
      symbol: r.symbol.replace(/\s+/g, " ").trim(),
      underlying: meta.underlying,
      isOption: meta.isOption,
      right: meta.right,
      strike: meta.strike,
      expiry: meta.expiry,
      dte,
      quantity: qty,
      isShort,
      avgPrice,
      mark,
      pnl,
      pnlPct,
      profitCapturedPct,
      strategy,
      atProfitTarget: profitCapturedPct !== null && profitCapturedPct >= RULES.profitTargetPct,
      nearExpiry: dte !== null && meta.isOption && dte <= RULES.dteWarning,
      theta: p.g?.position_theta ?? null,
      delta: p.g?.position_delta ?? null,
    };
  });
}

export const STRATEGY_ORDER: Strategy[] = [
  "CSP",
  "Covered Call",
  "Spread",
  "LEAP",
  "Long Call",
  "Long Put",
  "Stock",
];

export function groupByStrategy(positions: Position[]): Map<Strategy, Position[]> {
  const out = new Map<Strategy, Position[]>();
  for (const s of STRATEGY_ORDER) {
    const group = positions.filter((p) => p.strategy === s);
    if (group.length) out.set(s, group);
  }
  return out;
}
