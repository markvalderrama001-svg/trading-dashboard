/** Panel 5: Buying power & cash (TastyTrade, read-only). */

import { tastytrade } from "../lib/mcp";
import { Panel } from "../lib/panel";
import { REFRESH_MS, RULES } from "../config";
import { money, pct } from "../lib/fmt";

interface RawBalances {
  net_liq: string;
  cash: string;
  derivative_buying_power: string;
  equity_buying_power?: string;
}

interface Balances {
  netLiq: number;
  cash: number;
  derivativeBp: number;
  equityBp: number | null;
  cashPct: number | null;
}

async function load(): Promise<Balances> {
  const b = await tastytrade.call<RawBalances>("get_balances");
  const netLiq = Number(b.net_liq);
  const cash = Number(b.cash);
  return {
    netLiq,
    cash,
    derivativeBp: Number(b.derivative_buying_power),
    equityBp: b.equity_buying_power !== undefined ? Number(b.equity_buying_power) : null,
    cashPct: netLiq > 0 ? (cash / netLiq) * 100 : null,
  };
}

function render(b: Balances): string {
  const target = RULES.cashTargetPct;
  const actual = b.cashPct;
  // The bar is scaled so the target sits at a readable position even when
  // actual cash runs far above it (short puts hold cash as collateral).
  const scaleMax = Math.max(100, actual ?? 0);
  const fillPct = actual !== null ? (actual / scaleMax) * 100 : 0;
  const targetPos = (target / scaleMax) * 100;
  const state = actual === null ? "unknown" : actual >= target ? "ok" : "under";

  return `
    <div class="cash-figures">
      <div class="figure">
        <span class="figure-label">net liq</span>
        <span class="figure-val">${money(b.netLiq, false)}</span>
      </div>
      <div class="figure">
        <span class="figure-label">cash</span>
        <span class="figure-val">${money(b.cash, false)}</span>
      </div>
      <div class="figure">
        <span class="figure-label">derivative BP</span>
        <span class="figure-val">${money(b.derivativeBp, false)}</span>
      </div>
      ${
        b.equityBp !== null
          ? `<div class="figure">
               <span class="figure-label">equity BP</span>
               <span class="figure-val">${money(b.equityBp, false)}</span>
             </div>`
          : ""
      }
    </div>

    <div class="cash-target" data-state="${state}">
      <div class="cash-target-head">
        <span>cash / net liq</span>
        <span class="cash-actual">${pct(actual)} <span class="cash-vs">vs ${target}% target</span></span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${fillPct.toFixed(1)}%"></div>
        <div class="bar-target" style="left:${targetPos.toFixed(1)}%" title="${target}% target"></div>
      </div>
      <p class="panel-note">
        ${
          actual === null
            ? "Cash ratio unavailable."
            : actual >= target
              ? `Above the ${target}% floor by ${pct(actual - target)}.`
              : `Below the ${target}% floor by ${pct(target - actual)}. Raise cash.`
        }
      </p>
    </div>`;
}

export const cashPanel = new Panel<Balances>({
  id: "cash",
  title: "Buying Power & Cash",
  subtitle: "tastytrade · read-only",
  refreshMs: REFRESH_MS.account,
  load,
  render,
});
