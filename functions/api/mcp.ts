/**
 * Cloudflare Pages Function: MCP proxy.
 *
 * This is the ONLY place the bearer tokens exist. They are Cloudflare secrets,
 * read from `env` at request time, and never reach the browser bundle.
 *
 * It is also the read-only enforcement point. The allowlist below is the real
 * boundary: a tool that is not listed cannot be invoked through this proxy, no
 * matter what the client sends. Client-side discipline is a convenience; this
 * is the control.
 */

interface Env {
  TASTYTRADE_MCP_URL: string;
  ALPACA_MCP_URL?: string;
  TASTYTRADE_MCP_TOKEN: string;
  ALPACA_MCP_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
}

/** Upstream MCP endpoints come from configuration, never from the client. */
const SERVERS = ["tastytrade", "alpaca"] as const;
type ServerKey = (typeof SERVERS)[number];

function upstreamUrl(env: Env, server: ServerKey): string | undefined {
  return server === "tastytrade" ? env.TASTYTRADE_MCP_URL : env.ALPACA_MCP_URL;
}

/**
 * Read-only allowlist. Deliberately enumerated rather than derived by pattern
 * matching on names like /^get_/, because the TastyTrade server exposes destructive
 * tools (place_order, place_spread, place_option_order, cancel_order,
 * create_watchlist, update_watchlist) and a naming heuristic is one renamed
 * tool away from letting one through.
 */
const ALLOWED_TOOLS: Record<ServerKey, ReadonlySet<string>> = {
  tastytrade: new Set([
    "get_positions",
    "get_balances",
    "get_position_greeks",
    "get_watchlist",
    "list_watchlists",
    "get_index_trends",
    "get_fear_greed",
  ]),
  alpaca: new Set([
    "get_quote",
    "get_bars",
    "get_snapshot",
    "get_technical_analysis",
  ]),
};

/** JSON-RPC methods the client may issue at all. */
const ALLOWED_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "tools/call",
]);

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  // Default to same-origin only. ALLOWED_ORIGIN widens this for local dev.
  const allowed = env.ALLOWED_ORIGIN;
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    Vary: "Origin",
  };
  if (allowed && origin && (allowed === "*" || allowed.split(",").includes(origin))) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function deny(reason: string, env: Env, origin: string | null, status = 403): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, origin) },
  });
}

export const onRequestOptions: PagesFunction<Env> = ({ request, env }) =>
  new Response(null, { status: 204, headers: corsHeaders(env, request.headers.get("Origin")) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const server = url.searchParams.get("server") as ServerKey | null;

  if (!server || !(SERVERS as readonly string[]).includes(server)) {
    return deny("Unknown or missing ?server= (expected 'tastytrade' or 'alpaca')", env, origin, 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return deny("Malformed JSON body", env, origin, 400);
  }

  // Batch requests would let a disallowed call ride along beside a legal one.
  if (Array.isArray(body)) {
    return deny("Batched JSON-RPC is not accepted by this proxy", env, origin);
  }

  const method = body?.method;
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    return deny(`JSON-RPC method not permitted: ${String(method)}`, env, origin);
  }

  if (method === "tools/call") {
    const toolName = body?.params?.name;
    if (typeof toolName !== "string" || !ALLOWED_TOOLS[server].has(toolName)) {
      // Logged so an attempt is visible in `wrangler pages deployment tail`.
      console.warn(`[mcp-proxy] blocked tools/call: server=${server} tool=${String(toolName)}`);
      return deny(`Tool not on the read-only allowlist: ${String(toolName)}`, env, origin);
    }
  }

  const upstreamTarget = upstreamUrl(env, server);
  if (!upstreamTarget) {
    return deny(`No upstream URL configured for ${server}`, env, origin, 500);
  }

  const token = server === "tastytrade" ? env.TASTYTRADE_MCP_TOKEN : env.ALPACA_MCP_TOKEN;
  if (server === "tastytrade" && !token) {
    return deny("TASTYTRADE_MCP_TOKEN secret is not configured on this deployment", env, origin, 500);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const sessionId = request.headers.get("Mcp-Session-Id");
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamTarget, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    return deny(`Upstream unreachable: ${String((e as Error)?.message ?? e)}`, env, origin, 502);
  }

  const out = new Headers(corsHeaders(env, origin));
  out.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
  const sid = upstream.headers.get("Mcp-Session-Id");
  if (sid) out.set("Mcp-Session-Id", sid);

  return new Response(upstream.body, { status: upstream.status, headers: out });
};
