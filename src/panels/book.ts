/** Panel 1: Positions & book health (TastyTrade, read-only). */

import { alpaca, tastytrade } from "../lib/mcp";
import { Panel } from "../lib/panel";
import { REFRESH_MS, RULES, TRACKED_LEAPS } from "../config";
import {
  buildPositions,
  groupByStrategy,
  type Position,
  type RawGreek,
  type RawPosition,
} from "../lib/positions";
import { dateShort, dirClass, esc, money, num, signedMoney, signedPct } from "../lib/fmt";

interface BookData {
  positions: Position[];
  netTheta: number | null;
  netDelta: number | null;
}

async function load(): Promise<BookData> {
  // Two calls: cost basis lives on get_positions, marks live on get_position_greeks.
  const [raw, greeks] = await Promise.all([
    tastytrade.call<RawPosition[]>("get_positions"),
    tastytrade.call<{ net_greeks?: any; option_positions?: RawGreek[] }>("get_position_greeks"),
  ]);

  const rawPositions = Array.isArray(raw) ? raw : [];

  // TastyTrade's greeks payload has no marks for shares, so stock P/L needs
  // last-trade prices from Alpaca. Failures here are non-fatal; those rows
  // simply show no P/L rather than sinking the whole panel.
  const stockSymbols = [
    ...new Set(rawPositions.filter((p) => p.type === "Equity").map((p) => p.symbol.trim())),
  ];
  const stockMarks = new Map<string, number>();
  const snapshots = await Promise.allSettled(
    stockSymbols.map((symbol) =>
      alpaca
        .call<{ latestTrade?: { p?: number } }>("get_snapshot", { symbol })
        .then((s) => [symbol, s?.latestTrade?.p] as const),
    ),
  );
  for (const s of snapshots) {
    if (s.status === "fulfilled" && typeof s.value[1] === "number") {
      stockMarks.set(s.value[0], s.value[1]);
    }
  }

  const positions = buildPositions(
    rawPositions,
    greeks?.option_positions ?? [],
    new Date(),
    stockMarks,
  );

  return {
    positions,
    netTheta: greeks?.net_greeks?.theta ?? null,
    netDelta: greeks?.net_greeks?.delta ?? null,
  };
}

function positionRow(p: Position): string {
  const flags: string[] = [];
  if (p.atProfitTarget) flags.push(`<span class="flag flag-close">≥${RULES.profitTargetPct}% MAX</span>`);
  if (p.nearExpiry) flags.push(`<span class="flag flag-dte">${p.dte}D</span>`);

  const contract = p.isOption
    ? `${p.strike !== null ? `$${num(p.strike, p.strike % 1 ? 2 : 0)}` : ""}${p.right ?? ""}`
    : "shares";

  return `
    <tr class="${p.atProfitTarget ? "row-target" : ""} ${p.nearExpiry ? "row-warn" : ""}">
      <td class="t-sym">
        <span class="sym">${esc(p.underlying)}</span>
        <span class="contract">${esc(contract)}</span>
      </td>
      <td class="t-num">${p.isShort ? "−" : "+"}${p.quantity}</td>
      <td class="t-num">${p.expiry ? dateShort(p.expiry) : "—"}</td>
      <td class="t-num ${p.nearExpiry ? "neg" : ""}">${p.dte ?? "—"}</td>
      <td class="t-num">${money(p.avgPrice)}</td>
      <td class="t-num">${money(p.mark)}</td>
      <td class="t-num ${dirClass(p.pnl)}">${signedMoney(p.pnl)}</td>
      <td class="t-num ${dirClass(p.profitCapturedPct ?? p.pnlPct)}">
        ${p.profitCapturedPct !== null ? signedPct(p.profitCapturedPct) : signedPct(p.pnlPct)}
      </td>
      <td class="t-flags">${flags.join(" ")}</td>
    </tr>`;
}

function render(d: BookData): string {
  if (!d.positions.length) return `<div class="panel-empty">No open positions.</div>`;

  const groups = groupByStrategy(d.positions);
  const targets = d.positions.filter((p) => p.atProfitTarget);
  const expiring = d.positions.filter((p) => p.nearExpiry);
  const totalPnl = d.positions.reduce((a, p) => a + (p.pnl ?? 0), 0);

  const summary = `
    <div class="stat-row">
      <div class="stat"><span class="stat-label">open</span><span class="stat-val">${d.positions.length}</span></div>
      <div class="stat"><span class="stat-label">open P/L</span><span class="stat-val ${dirClass(totalPnl)}">${signedMoney(totalPnl)}</span></div>
      <div class="stat"><span class="stat-label">net θ</span><span class="stat-val ${dirClass(d.netTheta)}">${d.netTheta !== null ? num(d.netTheta, 0) : "—"}</span></div>
      <div class="stat"><span class="stat-label">net Δ</span><span class="stat-val">${d.netDelta !== null ? num(d.netDelta, 0) : "—"}</span></div>
      <div class="stat"><span class="stat-label">at target</span><span class="stat-val ${targets.length ? "accent" : ""}">${targets.length}</span></div>
      <div class="stat"><span class="stat-label">&lt;${RULES.dteWarning} DTE</span><span class="stat-val ${expiring.length ? "warn" : ""}">${expiring.length}</span></div>
    </div>`;

  const tables = [...groups.entries()]
    .map(
      ([strategy, rows]) => `
      <div class="group">
        <h3 class="group-head">${esc(strategy)} <span class="group-count">${rows.length}</span></h3>
        <table class="data">
          <thead>
            <tr>
              <th>position</th><th class="t-num">qty</th><th class="t-num">exp</th>
              <th class="t-num">dte</th><th class="t-num">basis</th><th class="t-num">mark</th>
              <th class="t-num">P/L</th><th class="t-num">%</th><th></th>
            </tr>
          </thead>
          <tbody>${rows.map(positionRow).join("")}</tbody>
        </table>
      </div>`,
    )
    .join("");

  return summary + tables + leapSection(d.positions);
}

/** Tracked LEAPs, including ones the account does not currently hold. */
function leapSection(positions: Position[]): string {
  const rows = TRACKED_LEAPS.map((underlying) => {
    const held = positions.filter(
      (p) => p.underlying === underlying && p.isOption && !p.isShort && p.right === "C",
    );

    if (!held.length) {
      return `
        <tr class="row-absent">
          <td class="t-sym"><span class="sym">${esc(underlying)}</span></td>
          <td colspan="5" class="t-absent">not held in this account</td>
        </tr>`;
    }

    return held
      .map(
        (p) => `
        <tr class="${(p.pnlPct ?? 0) < -50 ? "row-alert" : ""}">
          <td class="t-sym">
            <span class="sym">${esc(p.underlying)}</span>
            <span class="contract">$${num(p.strike, 0)}C</span>
          </td>
          <td class="t-num">${p.quantity}</td>
          <td class="t-num">${dateShort(p.expiry)}</td>
          <td class="t-num">${p.dte !== null ? `${p.dte}d` : "—"}</td>
          <td class="t-num ${dirClass(p.pnl)}">${signedMoney(p.pnl)}</td>
          <td class="t-num ${dirClass(p.pnlPct)}">${signedPct(p.pnlPct)}</td>
        </tr>`,
      )
      .join("");
  }).join("");

  return `
    <div class="group group-leap">
      <h3 class="group-head">Tracked LEAPs <span class="group-count">${TRACKED_LEAPS.length}</span></h3>
      <table class="data">
        <thead>
          <tr><th>contract</th><th class="t-num">qty</th><th class="t-num">expiry</th>
          <th class="t-num">countdown</th><th class="t-num">P/L</th><th class="t-num">%</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export const bookPanel = new Panel<BookData>({
  id: "book",
  title: "Positions & Book Health",
  subtitle: "tastytrade · read-only",
  refreshMs: REFRESH_MS.account,
  load,
  render,
});
