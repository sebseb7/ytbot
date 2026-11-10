import { ProxyAgent, request as undiciRequest } from "undici";
import type { ProxyConfig } from "./proxies.js";

export interface SimpleHttpResponse {
  status: number;
  text: string;
  json(): unknown;
}

export interface IHttpClient {
  get(url: string): Promise<SimpleHttpResponse>;
  post(url: string, jsonBody: unknown): Promise<SimpleHttpResponse>;
}

function parseSetCookie(
  setCookie: string | string[] | undefined,
  jar: Map<string, string>,
): void {
  if (!setCookie) return;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of cookies) {
    const pair = header.split(";")[0];
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string | undefined {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export interface DefaultHttpClientOptions {
  proxyConfig?: ProxyConfig | null;
  extraHeaders?: Record<string, string>;
}

/** Default HTTP client built on top of `undici` (Node's fetch stack). */
export class DefaultHttpClient implements IHttpClient {
  private dispatcher: ProxyAgent | undefined;
  private jar = new Map<string, string>();
  private baseHeaders: Record<string, string>;
  private retriesWhenBlocked: number;

  constructor(options: DefaultHttpClientOptions = {}) {
    const { proxyConfig = null, extraHeaders = {} } = options;
    this.baseHeaders = { "Accept-Language": "en-US", ...extraHeaders };
    if (proxyConfig) {
      const dict = proxyConfig.toRequestsDict();
      const proxyUrl = dict.https || dict.http;
      if (proxyUrl) {
        this.dispatcher = new ProxyAgent(proxyUrl);
      }
      if (proxyConfig.preventKeepingConnectionsAlive) {
        this.baseHeaders["Connection"] = "close";
      }
      this.retriesWhenBlocked = proxyConfig.retriesWhenBlocked;
    } else {
      this.retriesWhenBlocked = 0;
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.baseHeaders };
    const cookies = cookieHeader(this.jar);
    if (cookies) headers["Cookie"] = cookies;
    return headers;
  }

  private async rawRequest(
    method: "GET" | "POST",
    url: string,
    jsonBody?: unknown,
  ): Promise<{ status: number; text: string }> {
    const headers: Record<string, string> = this.buildHeaders();
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(jsonBody ?? {});
    }
    const response = await undiciRequest(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
    parseSetCookie(
      response.headers["set-cookie"] as string | string[] | undefined,
      this.jar,
    );
    const text = await response.body.text();
    return { status: response.statusCode, text };
  }

  private toSimpleResponse(
    status: number,
    text: string,
  ): SimpleHttpResponse {
    return {
      status,
      text,
      json(): unknown {
        return JSON.parse(text) as unknown;
      },
    };
  }

  async get(url: string): Promise<SimpleHttpResponse> {
    let last: { status: number; text: string } | undefined;
    const attempts = this.retriesWhenBlocked + 1;
    for (let i = 0; i < attempts; i++) {
      last = await this.rawRequest("GET", url);
      // Retry on 429 (blocked) so rotating proxies get a chance to rotate.
      if (last.status !== 429 || i === attempts - 1) break;
    }
    return this.toSimpleResponse(last!.status, last!.text);
  }

  async post(url: string, jsonBody: unknown): Promise<SimpleHttpResponse> {
    let last: { status: number; text: string } | undefined;
    const attempts = this.retriesWhenBlocked + 1;
    for (let i = 0; i < attempts; i++) {
      last = await this.rawRequest("POST", url, jsonBody);
      if (last.status !== 429 || i === attempts - 1) break;
    }
    return this.toSimpleResponse(last!.status, last!.text);
  }

  /** Set a cookie manually (used for the CONSENT flow). */
  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }
}
