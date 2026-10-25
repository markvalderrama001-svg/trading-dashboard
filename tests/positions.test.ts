import { describe, expect, it } from "vitest";
import { buildPositions, parseSymbol } from "../src/lib/positions";

const NOW = new Date(Date.UTC(2026, 0, 2));
const leg = (symbol: string, direction: "Long" | "Short", quantity: number, avg: string, type = "Equity Option") => ({
  symbol, direction, quantity, type, avg_price: avg,
});

describe("parseSymbol", () => {
  it("parses an OCC option symbol", () => {
    const p = parseSymbol("KO    260220P00060000");
    expect(p).toMatchObject({ underlying: "KO", isOption: true, right: "P", strike: 60 });
    expect((p.expiry as Date).toISOString().slice(0, 10)).toBe("2026-02-20");
  });
  it("treats plain tickers as stock", () => {
    expect(parseSymbol("AAPL")).toMatchObject({ underlying: "AAPL", isOption: false });
  });
});

describe("buildPositions", () => {
  it("pairs a vertical without swallowing a separate naked put at the same expiry", () => {
    const raw = [
      leg("XOM   260220P00105000", "Short", 1, "2.00"),
      leg("XOM   260220P00095000", "Long", 1, "0.50"),
      leg("XOM   260220P00120000", "Short", 1, "4.00"),
    ];
    const out = buildPositions(raw, [], NOW);
    const by = (s: number) => out.find((p) => p.strike === s)!.strategy;
    expect(by(105)).toBe("Spread");
    expect(by(95)).toBe("Spread");
    expect(by(120)).toBe("CSP");
  });

  it("recognises a covered call only when 100 shares per contract are held", () => {
    const call = leg("AAPL  260220C00240000", "Short", 1, "2.85");
    expect(buildPositions([call, leg("AAPL", "Long", 100, "210", "Equity")], [], NOW)[0].strategy).toBe("Covered Call");
    expect(buildPositions([call, leg("AAPL", "Long", 50, "210", "Equity")], [], NOW)[0].strategy).not.toBe("Covered Call");
  });

  it("computes short-option profit captured and flags the 50% target", () => {
    const raw = [leg("KO    260220P00060000", "Short", 2, "1.00")];
    const greeks = [{ symbol: "KO 260220P00060000", direction: "Short", quantity: 2, mark: 0.4 }];
    const [p] = buildPositions(raw, greeks, NOW);
    expect(p.profitCapturedPct).toBeCloseTo(60);
    expect(p.pnl).toBeCloseTo(120); // (1.00 - 0.40) * 2 contracts * 100
    expect(p.atProfitTarget).toBe(true);
  });

  it("never gives an option without a greek the stock's price as its mark", () => {
    const raw = [leg("KO    260220P00060000", "Short", 1, "1.00")];
    const [p] = buildPositions(raw, [], NOW, new Map([["KO", 63]]));
    expect(p.mark).toBeNull();
    expect(p.pnl).toBeNull();
  });
});
