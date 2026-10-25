/** Panel 4: News feed, via the /api/news Pages Function. */

import { Panel } from "../lib/panel";
import { REFRESH_MS, WHEEL_WATCHLIST } from "../config";
import { esc, safeHref } from "../lib/fmt";
import { DEMO, demoNews } from "../lib/demo";

interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedMs: number;
}

interface NewsData {
  items: NewsItem[];
  failed: string[];
}

/** Panel-local filter state; survives re-renders within the session. */
let filterTicker: string | null = null;

async function load(): Promise<NewsData> {
  if (DEMO) return demoNews();
  const res = await fetch("/api/news");
  if (!res.ok) throw new Error(`news proxy returned HTTP ${res.status}`);
  const body = await res.json();
  return { items: body.items ?? [], failed: body.failed ?? [] };
}

/**
 * Word-boundary match so "T" doesn't hit every headline containing the letter
 * and "GM" doesn't match "GMT".
 */
function mentions(title: string, ticker: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${ticker}([^A-Za-z0-9]|$)`).test(title);
}

function tickersIn(title: string): string[] {
  return WHEEL_WATCHLIST.filter((t) => mentions(title, t));
}

function timeAgo(ms: number): string {
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

function render(d: NewsData): string {
  // Only offer filter chips for tickers that actually appear in the feed.
  const counts = new Map<string, number>();
  for (const it of d.items) {
    for (const t of tickersIn(it.title)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([t, n]) =>
        `<button class="chip ${filterTicker === t ? "on" : ""}" data-ticker="${esc(t)}" type="button">${esc(t)}<span>${n}</span></button>`,
    )
    .join("");

  const visible = filterTicker ? d.items.filter((it) => mentions(it.title, filterTicker!)) : d.items;

  const rows = visible
    .slice(0, 60)
    .map((it) => {
      const tags = tickersIn(it.title)
        .map((t) => `<span class="tag">${esc(t)}</span>`)
        .join("");
      return `
        <li class="news-item">
          ${
            safeHref(it.link)
              ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>`
              : `<span class="news-title">${esc(it.title)}</span>`
          }
          <div class="news-meta">
            <span class="news-src">${esc(it.source)}</span>
            <span class="news-age">${esc(timeAgo(it.publishedMs))}</span>
            ${tags}
          </div>
        </li>`;
    })
    .join("");

  const failedNote = d.failed.length
    ? `<p class="panel-note warn">Feeds unavailable: ${esc(d.failed.join(", "))}</p>`
    : "";

  return `
    <div class="chip-row">
      <button class="chip ${filterTicker === null ? "on" : ""}" data-ticker="" type="button">all<span>${d.items.length}</span></button>
      ${chips}
    </div>
    ${failedNote}
    <ul class="news-list">${rows || `<li class="panel-empty">No headlines match ${esc(filterTicker ?? "")}.</li>`}</ul>`;
}

export const newsPanel = new Panel<NewsData>({
  id: "news",
  title: "News",
  subtitle: "reuters · cnbc · semis",
  refreshMs: REFRESH_MS.news,
  load,
  render,
});

// Chip clicks re-render from the cached feed. Filtering shouldn't refetch
// six RSS sources.
newsPanel.element.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
  if (!chip) return;
  const t = chip.dataset.ticker ?? "";
  filterTicker = t === "" ? null : t;
  newsPanel.rerenderFromCache();
});
