/**
 * Demo mode: synthetic data, no network, no credentials.
 *
 * Enabled by `npm run demo` (Vite mode "demo") or by adding `?demo` to the URL.
 * Every payload below mimics the shape the real MCP tools return, so the panels
 * run the exact same parsing, P/L and strategy-classification code paths.
 * All positions, balances and prices are invented.
 */

export const DEMO =
  import.meta.env.MODE === "demo" ||
  (typeof location !== "undefined" && new URLSearchParams(location.search).has("demo"));

/** Seeded PRNG so the demo looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** OCC symbol for an option expiring `days` from today, e.g. "KO    261218P00060000". */
function occ(root: string, days: number, right: "C" | "P", strike: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${root.padEnd(6, " ")}${yy}${mm}${dd}${right}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

// A small, plausible wheel book: CSPs, a covered call, a vertical, a LEAP, shares.
const LEGS = [
  { sym: occ("KO", 31, "P", 60), dir: "Short", qty: 2, avg: "1.10", mark: 0.42, delta: 18, theta: 6 },
  { sym: occ("JPM", 17, "P", 190), dir: "Short", qty: 1, avg: "3.20", mark: 2.95, delta: 31, theta: 9 },
  { sym: occ("MSFT", 45, "P", 380), dir: "Short", qty: 1, avg: "6.40", mark: 3.1, delta: 22, theta: 11 },
  { sym: occ("AAPL", 24, "C", 240), dir: "Short", qty: 1, avg: "2.85", mark: 1.2, delta: -28, theta: 7 },
  { sym: occ("XOM", 38, "P", 105), dir: "Short", qty: 2, avg: "2.10", mark: 1.65, delta: 24, theta: 8 },
  { sym: occ("XOM", 38, "P", 95), dir: "Long", qty: 2, avg: "0.70", mark: 0.48, delta: -9, theta: -3 },
  { sym: occ("NVDA", 420, "C", 150), dir: "Long", qty: 1, avg: "28.40", mark: 33.75, delta: 64, theta: -4 },
] as const;

const SHARES = [
  { sym: "AAPL", qty: 100, avg: "212.50", mark: 228.4 },
  { sym: "KO", qty: 200, avg: "61.30", mark: 63.05 },
];

function positions() {
  return [
    ...LEGS.map((l) => ({
      symbol: l.sym,
      quantity: l.qty,
      direction: l.dir,
      type: "Equity Option",
      avg_price: l.avg,
    })),
    ...SHARES.map((s) => ({
      symbol: s.sym,
      quantity: s.qty,
      direction: "Long",
      type: "Equity",
      avg_price: s.avg,
    })),
  ];
}

function positionGreeks() {
  const option_positions = LEGS.map((l) => ({
    symbol: l.sym,
    direction: l.dir,
    quantity: l.qty,
    mark: l.mark,
    position_delta: l.delta * l.qty,
    position_theta: l.theta * l.qty,
  }));
  return {
    net_greeks: {
      delta: option_positions.reduce((a, p) => a + p.position_delta, 0) + 300,
      theta: option_positions.reduce((a, p) => a + p.position_theta, 0),
    },
    option_positions,
  };
}

const WATCH_PRICES: Record<string, number> = {
  AAPL: 228.4, MSFT: 402.1, NVDA: 141.2, AMZN: 186.5, GOOGL: 167.3,
  META: 572.8, JPM: 193.6, BAC: 41.2, KO: 63.05, PEP: 158.9,
  XOM: 107.4, CVX: 151.3, UNH: 498.7, JNJ: 152.6, WMT: 81.9,
  HD: 371.2, DIS: 96.4, INTC: 22.8, F: 10.9, T: 21.7,
};

function technicalAnalysis(symbol: string) {
  const r = rng([...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const price = WATCH_PRICES[symbol] ?? 50 + r() * 100;
  // Spread %B across the range so the radar shows signals, near-misses and neutrals.
  const percentB = r() * 1.3 - 0.2;
  const width = price * (0.06 + r() * 0.08);
  const lower = price - percentB * width;
  return {
    symbol,
    price,
    dayChangePct: (r() - 0.5) * 4,
    rsi: 25 + percentB * 50 + (r() - 0.5) * 10,
    bollingerBands: { upper: lower + width, middle: lower + width / 2, lower, percentB },
    signals: [],
  };
}

function candles(seed: number, start: number, vol: number, n = 60) {
  const r = rng(seed);
  const out: { c: number }[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p *= 1 + (r() - 0.48) * vol;
    out.push({ c: p });
  }
  return out;
}

function indexTrends() {
  const make = (symbol: string, name: string, seed: number, start: number, vol: number) => {
    const c = candles(seed, start, vol);
    const last = c[c.length - 1].c;
    const pctFrom = (back: number) => ((last - c[c.length - 1 - back].c) / c[c.length - 1 - back].c) * 100;
    return { symbol, name, price: last, chg_pct: pctFrom(1), w1_pct: pctFrom(5), m1_pct: pctFrom(21), candles: c };
  };
  return {
    indexes: [
      make("VIX", "CBOE Volatility Index", 11, 18.5, 0.05),
      make("S&P 500", "S&P 500 Index", 22, 5650, 0.008),
      make("QQQ", "Invesco QQQ Trust", 33, 480, 0.011),
    ],
  };
}

function fearGreed() {
  const r = rng(99);
  const history = Array.from({ length: 120 }, (_, i) => ({ x: i, y: 40 + Math.sin(i / 12) * 18 + r() * 8 }));
  return {
    score: 58,
    rating: "greed",
    previous_close: 55,
    week_ago: 49,
    month_ago: 37,
    year_ago: 62,
    history,
    components: [
      { label: "Market momentum", score: 64, rating: "greed" },
      { label: "Stock price strength", score: 52, rating: "neutral" },
      { label: "Stock price breadth", score: 47, rating: "neutral" },
      { label: "Put/call options", score: 61, rating: "greed" },
      { label: "Market volatility", score: 50, rating: "neutral" },
      { label: "Safe-haven demand", score: 71, rating: "greed" },
      { label: "Junk bond demand", score: 58, rating: "greed" },
    ],
  };
}

const TOOLS: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_positions: positions,
  get_position_greeks: positionGreeks,
  get_balances: () => ({
    net_liq: "148250.00",
    cash: "41870.00",
    derivative_buying_power: "52400.00",
    equity_buying_power: "104800.00",
  }),
  get_index_trends: indexTrends,
  get_fear_greed: fearGreed,
  get_technical_analysis: (a) => technicalAnalysis(String(a.symbol)),
  get_snapshot: (a) => ({ latestTrade: { p: SHARES.find((s) => s.sym === a.symbol)?.mark ?? 100 } }),
};

/** Resolve a tool call from synthetic data, with a little latency so loading states show. */
export async function demoCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  await new Promise((res) => setTimeout(res, 150 + Math.random() * 350));
  const fn = TOOLS[name];
  if (!fn) throw new Error(`demo: no synthetic data for tool '${name}'`);
  return fn(args) as T;
}

export function demoNews() {
  const now = Date.now();
  const headlines = [
    ["Fed holds rates steady, signals patience on cuts", "Demo Wire"],
    ["NVDA extends rally as data-center orders climb", "Demo Markets"],
    ["KO raises dividend for the 60th straight year", "Demo Wire"],
    ["JPM beats on net interest income; shares edge higher", "Demo Markets"],
    ["Oil slips as inventories build; XOM, CVX lower", "Demo Energy"],
    ["MSFT cloud growth steadies, guidance in line", "Demo Tech"],
    ["Treasury yields drift lower ahead of jobs report", "Demo Wire"],
    ["AAPL services revenue hits record in quarter", "Demo Tech"],
    ["Retail sales beat expectations; WMT, HD gain", "Demo Markets"],
    ["Chip stocks mixed as INTC outlines turnaround plan", "Demo Tech"],
  ];
  return {
    items: headlines.map(([title, source], i) => ({
      title,
      source,
      link: "https://example.com/demo-news",
      publishedMs: now - (i * 47 + 12) * 60_000,
    })),
    failed: [],
  };
}
