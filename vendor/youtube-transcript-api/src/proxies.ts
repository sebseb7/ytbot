export interface RequestsProxyConfigDict {
  http: string;
  https: string;
}

export abstract class ProxyConfig {
  abstract toRequestsDict(): RequestsProxyConfigDict;

  /** Set to true to send `Connection: close` (useful for rotating proxies). */
  get preventKeepingConnectionsAlive(): boolean {
    return false;
  }

  /** How many times to retry when a request is blocked (triggers IP rotation). */
  get retriesWhenBlocked(): number {
    return 0;
  }
}

export class InvalidProxyConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProxyConfig";
  }
}

export interface GenericProxyOptions {
  httpUrl?: string | null;
  httpsUrl?: string | null;
}

export class GenericProxyConfig extends ProxyConfig {
  private readonly _httpUrl: string | null;
  private readonly _httpsUrl: string | null;

  constructor(httpUrl?: string | null, httpsUrl?: string | null) {
    super();
    if (!httpUrl && !httpsUrl) {
      throw new InvalidProxyConfig(
        "GenericProxyConfig requires you to define at least one of the two: http or https",
      );
    }
    this._httpUrl = httpUrl ?? null;
    this._httpsUrl = httpsUrl ?? null;
  }

  get httpUrl(): string | null {
    return this._httpUrl;
  }

  get httpsUrl(): string | null {
    return this._httpsUrl;
  }

  toRequestsDict(): RequestsProxyConfigDict {
    const http = this.httpUrl ?? this.httpsUrl;
    const https = this.httpsUrl ?? this.httpUrl;
    // Constructor guarantees at least one is set.
    return { http: http as string, https: https as string };
  }
}

export interface WebshareProxyOptions {
  proxyUsername: string;
  proxyPassword: string;
  filterIpLocations?: string[];
  retriesWhenBlocked?: number;
  domainName?: string;
  proxyPort?: number;
}

export class WebshareProxyConfig extends GenericProxyConfig {
  static readonly DEFAULT_DOMAIN_NAME = "p.webshare.io";
  static readonly DEFAULT_PORT = 80;

  readonly proxyUsername: string;
  readonly proxyPassword: string;
  readonly domainName: string;
  readonly proxyPort: number;
  private readonly filterIpLocations: string[];
  private readonly retries: number;
  /** Duck-typing flag used by RequestBlocked to pick the right message. */
  readonly isWebshare = true;

  constructor(options: WebshareProxyOptions) {
    super("http://placeholder.invalid", "http://placeholder.invalid");
    this.proxyUsername = options.proxyUsername;
    this.proxyPassword = options.proxyPassword;
    this.domainName =
      options.domainName ?? WebshareProxyConfig.DEFAULT_DOMAIN_NAME;
    this.proxyPort = options.proxyPort ?? WebshareProxyConfig.DEFAULT_PORT;
    this.filterIpLocations = options.filterIpLocations ?? [];
    this.retries = options.retriesWhenBlocked ?? 10;
  }

  get url(): string {
    const locationCodes = this.filterIpLocations
      .map((code) => `-${code.toUpperCase()}`)
      .join("");
    let username = this.proxyUsername;
    const suffix = "-rotate";
    if (username.endsWith(suffix)) {
      username = username.slice(0, -suffix.length);
    }
    return (
      `http://${username}${locationCodes}${suffix}:${this.proxyPassword}` +
      `@${this.domainName}:${this.proxyPort}/`
    );
  }

  override get httpUrl(): string {
    return this.url;
  }

  override get httpsUrl(): string {
    return this.url;
  }

  override get preventKeepingConnectionsAlive(): boolean {
    return true;
  }

  override get retriesWhenBlocked(): number {
    return this.retries;
  }

  override toRequestsDict(): RequestsProxyConfigDict {
    return { http: this.url, https: this.url };
  }
}
