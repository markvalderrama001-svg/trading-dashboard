/** Panel 2: Wheel radar (Alpaca technicals). One call per ticker. */

import { alpaca } from "../lib/mcp";
import { Panel } from "../lib/panel";
import { REFRESH_MS, WHEEL_WATCHLIST } from "../config";
import { dirClass, esc, money, num, signedPct } from "../lib/fmt";

interface TechnicalAnalysis {
  symbol: string;
  price: number;
  dayChangePct?: number;
  rsi?: number;
  bollingerBands?: { upper: number; middle: number; lower: number; percentB: number };
  signals?: string[];
}

interface Row extends Partial<TechnicalAnalysis> {
  symbol: string;
  error?: string;
}

async function load(): Promise<Row[]> {
  // Sequential-ish batching: 20 parallel calls can trip upstream rate limits,
  // so run in small waves and let individual failures degrade to a marked row.
  const rows: Row[] = [];
  const BATCH = 5;

  for (let i = 0; i < WHEEL_WATCHLIST.length; i += BATCH) {
    const slice = WHEEL_WATCHLIST.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      slice.map((symbol) => alpaca.call<TechnicalAnalysis>("get_technical_analysis", { symbol })),
    );
    settled.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value && typeof r.value.price === "number") {
        rows.push(r.value);
      } else {
        const reason = r.status === "rejected" ? (r.reason as Error)?.message : "no data";
        rows.push({ symbol: slice[j], error: reason ?? "no data" });
      }
    });
  }
  return rows;
}

/** %B ≤ 0 means price is at or below the lower band, the CSP entry signal. */
function atLowerBand(r: Row): boolean {
  return typeof r.bollingerBands?.percentB === "number" && r.bollingerBands.percentB <= 0;
}

function nearLowerBand(r: Row): boolean {
  const b = r.bollingerBands?.percentB;
  return typeof b === "number" && b > 0 && b <= 0.15;
}

function bandBar(percentB: number): string {
  // Clamp the marker into the track; %B can exceed 0–1 on band breaks.
  const clamped = Math.max(0, Math.min(1, percentB));
  const state = percentB <= 0 ? "at" : percentB <= 0.15 ? "near" : percentB >= 1 ? "over" : "mid";
  return `
    <div class="bb-track" title="%B ${num(percentB, 2)}" data-state="${state}">
      <span class="bb-mark" style="left:${(clamped * 100).toFixed(1)}%"></span>
    </div>`;
}

function rsiClass(rsi: number | undefined): string {
  if (typeof rsi !== "number") return "";
  if (rsi <= 30) return "pos";
  if (rsi >= 70) return "neg";
  return "";
}

function render(rows: Row[]): string {
  // Signal candidates float to the top; the rest keep watchlist order.
  const sorted = [...rows].sort((a, b) => {
    const rank = (r: Row) => (atLowerBand(r) ? 0 : nearLowerBand(r) ? 1 : r.error ? 3 : 2);
    return rank(a) - rank(b);
  });

  const signals = rows.filter(atLowerBand).length;
  const failed = rows.filter((r) => r.error).length;

  const head = `
    <div class="stat-row">
      <div class="stat"><span class="stat-label">tracked</span><span class="stat-val">${rows.length}</span></div>
      <div class="stat"><span class="stat-label">at lower band</span><span class="stat-val ${signals ? "accent" : ""}">${signals}</span></div>
      ${failed ? `<div class="stat"><span class="stat-label">no data</span><span class="stat-val warn">${failed}</span></div>` : ""}
    </div>`;

  const body = sorted
    .map((r) => {
      if (r.error) {
        return `<tr class="row-absent">
          <td class="t-sym"><span class="sym">${esc(r.symbol)}</span></td>
          <td colspan="5" class="t-absent">${esc(r.error)}</td>
        </tr>`;
      }
      const b = r.bollingerBands;
      return `
        <tr class="${atLowerBand(r) ? "row-signal" : nearLowerBand(r) ? "row-warn" : ""}">
          <td class="t-sym"><span class="sym">${esc(r.symbol)}</span></td>
          <td class="t-num">${money(r.price ?? null)}</td>
          <td class="t-num ${dirClass(r.dayChangePct ?? null)}">${signedPct(r.dayChangePct ?? null)}</td>
          <td class="t-bb">${b ? bandBar(b.percentB) : "—"}</td>
          <td class="t-num">${b ? money(b.lower) : "—"}</td>
          <td class="t-num ${rsiClass(r.rsi)}">${r.rsi !== undefined ? num(r.rsi, 1) : "—"}</td>
        </tr>`;
    })
    .join("");

  return `${head}
    <table class="data">
      <thead>
        <tr><th>ticker</th><th class="t-num">price</th><th class="t-num">day</th>
        <th>BB(20,2) %B</th><th class="t-num">lower</th><th class="t-num">RSI</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    <p class="panel-note">Highlighted rows sit at or below the lower Bollinger band: CSP entry signal.</p>`;
}

export const wheelPanel = new Panel<Row[]>({
  id: "wheel",
  title: "Wheel Radar",
  subtitle: "alpaca · BB(20,2) + RSI",
  refreshMs: REFRESH_MS.market,
  load,
  render,
});
