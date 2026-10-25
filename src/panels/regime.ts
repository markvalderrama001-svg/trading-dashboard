/**
 * Panel 3: Regime.
 *
 * Sourced from TastyTrade's get_index_trends, not Alpaca: Alpaca serves
 * equities only and returns zero bars for VIX and SPX.
 */

import { tastytrade } from "../lib/mcp";
import { Panel } from "../lib/panel";
import { REFRESH_MS, RULES, VIX_BANDS } from "../config";
import { dirClass, esc, num, signedPct } from "../lib/fmt";

interface RawIndex {
  symbol: string;
  name: string;
  price: number;
  chg_pct: number;
  w1_pct?: number;
  m1_pct?: number;
  candles?: { c: number }[];
}

interface Index {
  symbol: string;
  name: string;
  price: number;
  chgPct: number;
  w1Pct: number | null;
  m1Pct: number | null;
  spark: number[];
}

async function load(): Promise<Index[]> {
  const res = await tastytrade.call<{ indexes: RawIndex[] }>("get_index_trends");
  const wanted = ["VIX", "S&P 500", "QQQ"];

  return (res?.indexes ?? [])
    .filter((i) => wanted.includes(i.symbol))
    .sort((a, b) => wanted.indexOf(a.symbol) - wanted.indexOf(b.symbol))
    .map((i) => ({
      symbol: i.symbol,
      name: i.name,
      price: i.price,
      chgPct: i.chg_pct,
      w1Pct: i.w1_pct ?? null,
      m1Pct: i.m1_pct ?? null,
      // Keep only closes. The full candle set is far too large for localStorage.
      spark: (i.candles ?? []).map((c) => c.c).slice(-60),
    }));
}

type VixBand = "calm" | "elevated" | "stressed";

function vixBand(v: number): VixBand {
  if (v < VIX_BANDS.calm) return "calm";
  if (v <= VIX_BANDS.elevated) return "elevated";
  return "stressed";
}

const BAND_COPY: Record<VixBand, string> = {
  calm: "Calm: normal position sizing.",
  elevated: "Elevated: tighten new entries.",
  stressed: `Stressed: raise cash toward ${RULES.cashTargetPct}%.`,
};

/** Inline sparkline. Values are normalised to the panel's own min/max. */
function sparkline(values: number[], cls: string): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100;
  const h = 28;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`)
    .join(" ");
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

function render(indexes: Index[]): string {
  if (!indexes.length) return `<div class="panel-empty">No index data.</div>`;

  const vix = indexes.find((i) => i.symbol === "VIX");
  const band = vix ? vixBand(vix.price) : null;

  const banner =
    vix && band
      ? `<div class="regime-banner" data-band="${band}">
           <div class="regime-vix">
             <span class="regime-label">VIX</span>
             <span class="regime-val">${num(vix.price, 2)}</span>
             <span class="regime-chg ${dirClass(vix.chgPct)}">${signedPct(vix.chgPct)}</span>
           </div>
           <div class="regime-copy">${esc(BAND_COPY[band])}</div>
           <div class="regime-scale">
             <span class="seg calm ${band === "calm" ? "on" : ""}">&lt;${VIX_BANDS.calm}</span>
             <span class="seg elevated ${band === "elevated" ? "on" : ""}">${VIX_BANDS.calm}–${VIX_BANDS.elevated}</span>
             <span class="seg stressed ${band === "stressed" ? "on" : ""}">&gt;${VIX_BANDS.elevated}</span>
           </div>
         </div>`
      : "";

  const cards = indexes
    .map(
      (i) => `
      <div class="idx-card">
        <div class="idx-top">
          <span class="idx-sym">${esc(i.symbol)}</span>
          <span class="idx-chg ${dirClass(i.chgPct)}">${signedPct(i.chgPct)}</span>
        </div>
        <div class="idx-price">${num(i.price, i.price > 1000 ? 0 : 2)}</div>
        ${sparkline(i.spark, dirClass(i.chgPct))}
        <div class="idx-foot">
          <span>1w <b class="${dirClass(i.w1Pct)}">${signedPct(i.w1Pct)}</b></span>
          <span>1m <b class="${dirClass(i.m1Pct)}">${signedPct(i.m1Pct)}</b></span>
        </div>
      </div>`,
    )
    .join("");

  return `${banner}<div class="idx-grid">${cards}</div>`;
}

export const regimePanel = new Panel<Index[]>({
  id: "regime",
  title: "Regime",
  subtitle: "VIX · SPX · QQQ",
  refreshMs: REFRESH_MS.market,
  load,
  render,
});
