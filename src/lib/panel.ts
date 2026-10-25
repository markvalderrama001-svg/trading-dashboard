/**
 * Panel shell: header, status dot, manual refresh, stale-data labelling,
 * and the cache-first render cycle.
 *
 * Contract: `load()` fetches fresh data, `render()` turns data into HTML.
 * A panel paints from cache immediately, then swaps in live data when it
 * arrives. If `load()` throws, the cached view stays up and is marked stale.
 */

import { readCache, writeCache, ageLabel } from "./cache";
import { esc } from "./fmt";
import { DEMO } from "./demo";

export type PanelState = "live" | "stale" | "loading" | "error";

export interface PanelOptions<T> {
  id: string;
  title: string;
  subtitle?: string;
  refreshMs: number;
  load: () => Promise<T>;
  render: (data: T) => string;
}

export class Panel<T> {
  private el: HTMLElement;
  private bodyEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private timer: number | null = null;
  private inFlight = false;

  constructor(private readonly opts: PanelOptions<T>) {
    this.el = document.createElement("section");
    this.el.className = "panel";
    this.el.id = `panel-${opts.id}`;
    this.el.innerHTML = `
      <header class="panel-head">
        <div class="panel-title">
          <h2>${esc(opts.title)}</h2>
          ${opts.subtitle ? `<span class="panel-sub">${esc(opts.subtitle)}</span>` : ""}
        </div>
        <div class="panel-actions">
          <span class="panel-status" data-state="loading">initialising</span>
          <button class="refresh-btn" type="button" title="Refresh now" aria-label="Refresh ${esc(opts.title)}">&#8635;</button>
        </div>
      </header>
      <div class="panel-body"><div class="panel-empty">loading…</div></div>
    `;
    this.bodyEl = this.el.querySelector(".panel-body")!;
    this.statusEl = this.el.querySelector(".panel-status")!;
    this.el.querySelector(".refresh-btn")!.addEventListener("click", () => void this.refresh(true));
  }

  get element(): HTMLElement {
    return this.el;
  }

  private setStatus(state: PanelState, text: string): void {
    this.statusEl.dataset.state = state;
    this.statusEl.textContent = text;
  }

  /** Paint whatever is cached, so the grid is never blank on load. */
  paintFromCache(): void {
    const cached = readCache<T>(this.opts.id);
    if (!cached) return;
    try {
      this.bodyEl.innerHTML = this.opts.render(cached.data);
      this.setStatus("stale", `cached · ${ageLabel(cached.savedAt)}`);
    } catch {
      /* a shape change in cached data shouldn't break startup */
    }
  }

  /**
   * Re-render cached data without refetching. For view-only state changes
   * (filters, sorts) where a network round-trip would be wasted.
   */
  rerenderFromCache(): void {
    const cached = readCache<T>(this.opts.id);
    if (!cached) return;
    this.bodyEl.innerHTML = this.opts.render(cached.data);
  }

  async refresh(manual = false): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    if (manual) this.setStatus("loading", "refreshing…");

    try {
      const data = await this.opts.load();
      this.bodyEl.innerHTML = this.opts.render(data);
      writeCache(this.opts.id, data);
      // In demo mode the data is synthetic, so the badge must not claim "live".
      const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
      this.setStatus("live", `${DEMO ? "demo" : "live"} · ${stamp}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const cached = readCache<T>(this.opts.id);
      if (cached) {
        // Keep the last good view up rather than blanking the panel.
        this.setStatus("error", `stale · ${ageLabel(cached.savedAt)} · ${truncate(msg)}`);
      } else {
        this.bodyEl.innerHTML = `<div class="panel-error">Could not load.<br><span>${esc(truncate(msg, 200))}</span></div>`;
        this.setStatus("error", "unavailable");
      }
      console.error(`[panel:${this.opts.id}]`, e);
    } finally {
      this.inFlight = false;
    }
  }

  start(): void {
    this.paintFromCache();
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), this.opts.refreshMs);
    // Catch up after the tab was backgrounded past an interval.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.refresh();
    });
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
