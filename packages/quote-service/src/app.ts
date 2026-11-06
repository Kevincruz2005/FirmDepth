import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import type { FirmQuoteRequestBody, SepoliaManifest } from "./types.js";
import { parseQuoteRequest, QuoteError } from "./quote-engine.js";

export interface AppDependencies {
  manifest: SepoliaManifest;
  runtime: Record<string, unknown>;
  corsOrigins: ReadonlySet<string>;
  production: boolean;
  health(): Promise<Record<string, unknown>>;
  settlementQuote?(request: unknown): Promise<FirmQuoteEnvelope>;
  quote(request: FirmQuoteRequestBody): Promise<FirmQuoteEnvelope>;
  log(event: Record<string, unknown>): void;
}

export function createHandler(dependencies: AppDependencies) {
  const limiter = new IpRateLimiter(20, 60_000);
  return async (request: IncomingMessage, response: ServerResponse) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let status = 500;
    try {
      secureHeaders(response);
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (!dependencies.corsOrigins.has(origin)) return json(response, status = 403, { error: "Origin is not allowed", requestId });
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type");
        response.statusCode = status = 204;
        return response.end();
      }
      if (dependencies.production && request.headers["x-forwarded-proto"] !== "https") return json(response, status = 426, { error: "HTTPS is required", requestId });
      const ip = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown").split(",")[0]!.trim();
      if (!limiter.take(ip)) return json(response, status = 429, { error: "Rate limit exceeded", requestId });
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/health" && request.method === "GET") return json(response, status = 200, { ...(await dependencies.health()), requestId });
      if (path === "/runtime" && request.method === "GET") return json(response, status = 200, dependencies.runtime);
      if (path === "/quote/settlement" && dependencies.settlementQuote) {
        if (request.method !== "POST") return json(response, status = 405, { error: "Method not allowed", requestId });
        return json(response, status = 200, await dependencies.settlementQuote(JSON.parse(await readBody(request))));
      }
      if (path === "/quote/firm") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          return json(response, status = 405, { error: "Method not allowed", requestId });
        }
        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) return json(response, status = 415, { error: "Content-Type must be application/json", requestId });
        const parsed = parseQuoteRequest(JSON.parse(await readBody(request)), dependencies.manifest);
        return json(response, status = 200, await dependencies.quote(parsed));
      }
      return json(response, status = 404, { error: "Not found", requestId });
    } catch (cause) {
      status = cause instanceof QuoteError ? cause.statusCode : cause instanceof SyntaxError ? 400 : message(cause).includes("too large") ? 413 : 500;
      return json(response, status, { error: status === 500 ? "Quote service request failed" : message(cause), requestId });
    } finally {
      dependencies.log({ event: "http_request", requestId, method: request.method, path: new URL(request.url ?? "/", "http://localhost").pathname, status, durationMs: Date.now() - startedAt });
    }
  };
}

export async function readBody(request: AsyncIterable<Uint8Array | string>): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (Buffer.byteLength(body) > 16_384) throw new QuoteError(413, "Request body is too large");
  }
  if (body.length === 0) throw new QuoteError(400, "Request body is required");
  return body;
}

export class IpRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly burst: number, private readonly windowMs: number) {}
  take(ip: string, now = Date.now()): boolean {
    const previous = this.entries.get(ip);
    if (!previous || previous.resetAt <= now) {
      this.entries.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (previous.count >= this.burst) return false;
    previous.count += 1;
    return true;
  }
}

function secureHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : "Invalid request"; }
