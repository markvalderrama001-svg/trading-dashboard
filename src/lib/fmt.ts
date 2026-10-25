/** Display formatting. Numerals render in a monospace column everywhere. */

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: number | null, decimals = true): string =>
  n === null || !Number.isFinite(n) ? "—" : (decimals ? usd2 : usd0).format(n);

export const signedMoney = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${usd2.format(Math.abs(n))}`;

export const pct = (n: number | null, decimals = 1): string =>
  n === null || !Number.isFinite(n) ? "—" : `${n.toFixed(decimals)}%`;

export const signedPct = (n: number | null, decimals = 1): string =>
  n === null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(decimals)}%`;

export const num = (n: number | null, decimals = 2): string =>
  n === null || !Number.isFinite(n) ? "—" : n.toFixed(decimals);

/**
 * Accepts a Date, an ISO string, or an epoch number.
 *
 * The string case is not hypothetical: cached panel data round-trips through
 * JSON.stringify in localStorage, which turns every Date into a string. A
 * Date-only signature here throws on the cache-first paint.
 */
export const dateShort = (d: Date | string | number | null): string => {
  if (d === null || d === undefined || d === "") return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    timeZone: "UTC",
  });
};

/** Escape untrusted strings. News titles come from third-party feeds. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Directional class for coloring gains green / losses red. */
export const dirClass = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : n > 0 ? "pos" : n < 0 ? "neg" : "";

/**
 * Feed links are untrusted. Only plain http(s) URLs become clickable, so a
 * `javascript:` or `data:` link in a hostile feed can't run in our origin.
 */
export function safeHref(link: unknown): link is string {
  return typeof link === "string" && /^https?:\/\//i.test(link.trim());
}
