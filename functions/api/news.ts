/**
 * Cloudflare Pages Function: RSS aggregator.
 *
 * Browsers can't fetch these feeds cross-origin, so the parsing happens here.
 * Feeds are fixed server-side rather than taken from a query param, so this
 * can't be turned into an open proxy for arbitrary URLs.
 */

interface Env {
  ALLOWED_ORIGIN?: string;
}

/**
 * Reuters retired its public RSS endpoints (feeds.reuters.com no longer
 * resolves) and AnandTech shut down, so neither is usable. MarketWatch and
 * Yahoo Finance stand in for the business/markets wire; SemiEngineering
 * replaces AnandTech for semis. Every URL here was verified to respond.
 */
const FEEDS = [
  { source: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { source: "MarketWatch Pulse", url: "https://feeds.content.dowjones.io/public/rss/mw_marketpulse" },
  { source: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { source: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
  { source: "CNBC Finance", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664" },
  { source: "Semiconductor Digest", url: "https://www.semiconductor-digest.com/feed/" },
  { source: "SemiEngineering", url: "https://semiengineering.com/feed/" },
];

interface Item {
  title: string;
  link: string;
  source: string;
  published: string | null;
  publishedMs: number;
}

/** Minimal RSS/Atom extraction. Workers have no DOMParser, so this is regex-based. */
function parseFeed(xml: string, source: string): Item[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const items: Item[] = [];

  for (const block of blocks) {
    const title = decode(pick(block, "title"));
    let link = pick(block, "link");
    if (!link) {
      // Atom puts the URL in an attribute rather than the element body.
      link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? "";
    }
    const dateRaw = pick(block, "pubDate") || pick(block, "updated") || pick(block, "published");
    if (!title || !link) continue;

    const ms = dateRaw ? Date.parse(dateRaw) : NaN;
    items.push({
      title,
      link: decode(link).trim(),
      source,
      published: dateRaw || null,
      publishedMs: Number.isNaN(ms) ? 0 : ms,
    });
  }
  return items;
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Collapse near-duplicates: same story syndicated across feeds. */
function dedupe(items: Item[]): Item[] {
  const seen = new Map<string, Item>();
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
    const prior = seen.get(key);
    // Keep whichever copy carries the newer timestamp.
    if (!prior || it.publishedMs > prior.publishedMs) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => b.publishedMs - a.publishedMs);
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await fetch(f.url, {
        headers: { "User-Agent": "trading-dashboard/0.1 (+personal)" },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      if (!res.ok) throw new Error(`${f.source}: HTTP ${res.status}`);
      return parseFeed(await res.text(), f.source);
    }),
  );

  const items: Item[] = [];
  const failed: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else failed.push(FEEDS[i].source);
  });

  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300",
  };
  if (env.ALLOWED_ORIGIN && origin) {
    if (env.ALLOWED_ORIGIN === "*" || env.ALLOWED_ORIGIN.split(",").includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
  }

  // A partial result is still useful; `failed` lets the panel say so.
  return new Response(
    JSON.stringify({ items: dedupe(items).slice(0, 120), failed, fetchedAt: Date.now() }),
    { headers },
  );
};
