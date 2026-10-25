/**
 * Minimal MCP client: JSON-RPC 2.0 over Streamable HTTP.
 *
 * Talks only to the same-origin /api/mcp proxy, never to the workers directly.
 * No token lives here; the proxy attaches it. See functions/api/mcp.ts.
 *
 * Handshake: initialize -> notifications/initialized -> tools/list -> tools/call.
 * The session id comes back on the initialize response header and must be echoed
 * on every subsequent request.
 */

import { DEMO, demoCall } from "./demo";

export type ServerKey = "tastytrade" | "alpaca";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

export class McpError extends Error {
  constructor(message: string, readonly server: ServerKey, readonly cause?: unknown) {
    super(message);
    this.name = "McpError";
  }
}

export class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private ready: Promise<McpTool[]> | null = null;
  private tools: McpTool[] = [];

  constructor(private readonly server: ServerKey) {}

  private endpoint(): string {
    return `/api/mcp?server=${this.server}`;
  }

  private async rpc(method: string, params?: unknown, isNotification = false): Promise<any> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    if (!isNotification) payload.id = this.nextId++;

    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    // The proxy hands back the session id from initialize; capture it once.
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid && !this.sessionId) this.sessionId = sid;

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) detail = String(body.error);
      } catch {
        /* keep the status-only message */
      }
      throw new McpError(`${method} failed: ${detail}`, this.server);
    }

    if (isNotification) return undefined;

    const text = await res.text();
    if (!text.trim()) return undefined;

    const parsed = parseMaybeSse(text);
    if (parsed.error) {
      throw new McpError(`${method}: ${parsed.error.message}`, this.server, parsed.error);
    }
    return parsed.result;
  }

  /** Handshake + tools/list. Cached, and retried fresh if it failed. */
  async connect(): Promise<McpTool[]> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.rpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "trading-dashboard", version: "0.1.0" },
        });
        // Best-effort: some servers don't implement the notification.
        try {
          await this.rpc("notifications/initialized", {}, true);
        } catch {
          /* non-fatal */
        }
        const listed = await this.rpc("tools/list");
        this.tools = Array.isArray(listed?.tools) ? listed.tools : [];
        return this.tools;
      })().catch((e) => {
        this.ready = null; // allow a later retry instead of caching the failure
        this.sessionId = null;
        throw e;
      });
    }
    return this.ready;
  }

  /** True if the server actually advertises this tool. */
  async has(name: string): Promise<boolean> {
    const tools = await this.connect();
    return tools.some((t) => t.name === name);
  }

  /**
   * Call a tool by name, after confirming the live server advertises it.
   * Returns the parsed JSON payload when the tool emits JSON text, else raw text.
   */
  async call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (DEMO) return demoCall<T>(name, args);
    const tools = await this.connect();
    if (!tools.some((t) => t.name === name)) {
      throw new McpError(
        `Tool '${name}' is not advertised by the ${this.server} server (tools/list: ${tools
          .map((t) => t.name)
          .join(", ")})`,
        this.server,
      );
    }

    const result = await this.rpc("tools/call", { name, arguments: args });
    if (result?.isError) {
      throw new McpError(`Tool '${name}' returned an error: ${extractText(result)}`, this.server);
    }

    const text = extractText(result);
    if (!text) return result as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}

function extractText(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
}

/**
 * Streamable HTTP may answer with either plain JSON or an SSE frame
 * (`event: message\ndata: {...}`). Handle both.
 */
function parseMaybeSse(text: string): JsonRpcResponse {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (!dataLines.length) throw new Error(`Unparseable MCP response: ${text.slice(0, 200)}`);
  return JSON.parse(dataLines.join(""));
}

export const tastytrade = new McpClient("tastytrade");
export const alpaca = new McpClient("alpaca");
