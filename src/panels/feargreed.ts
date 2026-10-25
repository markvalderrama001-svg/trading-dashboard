/** Panel 7: CNN Fear & Greed (TastyTrade, read-only). */

import { tastytrade } from "../lib/mcp";
import { Panel } from "../lib/panel";
import { REFRESH_MS } from "../config";
import { esc, num } from "../lib/fmt";

interface Component {
  label: string;
  score: number;
  rating: string;
}

interface FearGreedData {
  score: number;
  rating: string;
  previousClose: number | null;
  weekAgo: number | null;
  monthAgo: number | null;
  yearAgo: number | null;
  components: Component[];
  history: number[];
}

async function load(): Promise<FearGreedData> {
  const r = await tastytrade.call<any>("get_fear_greed");
  return {
    score: r?.score ?? 0,
    rating: r?.rating ?? "—",
    previousClose: r?.previous_close ?? null,
    weekAgo: r?.week_ago ?? null,
    monthAgo: r?.month_ago ?? null,
    yearAgo: r?.year_ago ?? null,
    components: Array.isArray(r?.components) ? r.components : [],
    history: Array.isArray(r?.history) ? r.history.map((h: any) => h.y).filter((y: any) => typeof y === "number") : [],
  };
}

/** CNN's five bands, mapped to the same palette as the VIX regime strip. */
function band(score: number): { key: string; color: string } {
  if (score < 25) return { key: "extreme fear", color: "var(--neg)" };
  if (score < 45) return { key: "fear", color: "var(--warn)" };
  if (score < 55) return { key: "neutral", color: "var(--text-dim)" };
  if (score < 75) return { key: "greed", color: "var(--pos)" };
  return { key: "extreme greed", color: "var(--signal)" };
}

/** Semicircular gauge, 0 (left) → 100 (right). */
function gauge(score: number, color: string): string {
  const r = 52;
  const cx = 60;
  const cy = 60;
  const angle = Math.PI * (1 - score / 100); // 0 -> π (left), 100 -> 0 (right)
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);
  const arc = (from: number, to: number, stroke: string) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const x0 = cx + r * Math.cos(a0), y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
    return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="butt"/>`;
  };
  return `
    <svg class="fg-gauge" viewBox="0 0 120 74" aria-hidden="true">
      ${arc(0, 25, "var(--neg)")}
      ${arc(25, 45, "var(--warn)")}
      ${arc(45, 55, "var(--text-faint)")}
      ${arc(55, 75, "var(--pos)")}
      ${arc(75, 100, "var(--signal)")}
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${color}" stroke-width="2.5"/>
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="${color}"/>
    </svg>`;
}

function delta(now: number, then: number | null): string {
  if (then === null) return "—";
  const d = now - then;
  const cls = d > 0 ? "pos" : d < 0 ? "neg" : "";
  return `<b class="${cls}">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}</b>`;
}

function sparkline(values: number[]): string {
  if (values.length < 2) return "";
  const v = values.slice(-90);
  const w = 100, h = 22;
  // Fixed 0–100 domain so the line reads as an absolute fear/greed level.
  const pts = v
    .map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - (y / 100) * h).toFixed(1)}`)
    .join(" ");
  return `<svg class="fg-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

function render(d: FearGreedData): string {
  const b = band(d.score);

  const comps = d.components
    .map((c) => {
      const cb = band(c.score);
      return `
        <div class="fg-comp">
          <span class="fg-comp-label">${esc(c.label)}</span>
          <div class="fg-comp-track"><span class="fg-comp-fill" style="width:${Math.max(0, Math.min(100, c.score)).toFixed(0)}%;background:${cb.color}"></span></div>
          <span class="fg-comp-val">${num(c.score, 0)}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="fg-top">
      <div class="fg-gauge-wrap">
        ${gauge(d.score, b.color)}
        <div class="fg-score" style="color:${b.color}">${num(d.score, 0)}</div>
        <div class="fg-rating" style="color:${b.color}">${esc(d.rating)}</div>
      </div>
      <div class="fg-deltas">
        <div><span>prev close</span>${delta(d.score, d.previousClose)}</div>
        <div><span>week ago</span>${delta(d.score, d.weekAgo)}</div>
        <div><span>month ago</span>${delta(d.score, d.monthAgo)}</div>
        <div><span>year ago</span>${delta(d.score, d.yearAgo)}</div>
      </div>
    </div>
    <div class="fg-spark-wrap" style="color:${b.color}">${sparkline(d.history)}</div>
    <div class="fg-comps">${comps}</div>`;
}

export const fearGreedPanel = new Panel<FearGreedData>({
  id: "feargreed",
  title: "Fear & Greed",
  subtitle: "cnn · 7 factors",
  refreshMs: REFRESH_MS.market,
  load,
  render,
});
