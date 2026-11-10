import { decode as decodeHtmlEntities } from "./entities.js";
import {
  AgeRestricted,
  FailedToCreateConsentCookie,
  InvalidVideoId,
  IpBlocked,
  NoTranscriptFound,
  NotTranslatable,
  PoTokenRequired,
  RequestBlocked,
  TranscriptsDisabled,
  TranslationLanguageNotAvailable,
  VideoUnavailable,
  VideoUnplayable,
  YouTubeDataUnparsable,
  YouTubeRequestFailed,
} from "./errors.js";
import type { IHttpClient } from "./http.js";
import type { ProxyConfig } from "./proxies.js";
import { INNERTUBE_API_URL, INNERTUBE_CONTEXT, WATCH_URL } from "./settings.js";

export interface FetchedTranscriptSnippet {
  text: string;
  /** Timestamp in seconds at which this snippet appears on screen. */
  start: number;
  /**
   * How long the snippet stays on screen in seconds. Note this is NOT the
   * duration of the transcribed speech — snippets may overlap!
   */
  duration: number;
}

export interface FetchedTranscript
  extends Iterable<FetchedTranscriptSnippet> {
  snippets: FetchedTranscriptSnippet[];
  videoId: string;
  language: string;
  languageCode: string;
  isGenerated: boolean;
  toRawData(): Array<{ text: string; start: number; duration: number }>;
}

export function createFetchedTranscript(
  snippets: FetchedTranscriptSnippet[],
  videoId: string,
  language: string,
  languageCode: string,
  isGenerated: boolean,
): FetchedTranscript {
  return {
    snippets,
    videoId,
    language,
    languageCode,
    isGenerated,
    toRawData() {
      return this.snippets.map((s) => ({
        text: s.text,
        start: s.start,
        duration: s.duration,
      }));
    },
    *[Symbol.iterator]() {
      yield* this.snippets;
    },
  } as FetchedTranscript;
}

export interface TranslationLanguage {
  language: string;
  languageCode: string;
}

const PlayabilityStatus = {
  OK: "OK",
  ERROR: "ERROR",
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
} as const;

const PlayabilityFailedReason = {
  BOT_DETECTED: "Sign in to confirm you’re not a bot",
  AGE_RESTRICTED: "This video may be inappropriate for some users.",
  VIDEO_UNAVAILABLE: "This video is unavailable",
} as const;

function raiseForStatus(
  status: number,
  statusText: string,
  videoId: string,
): void {
  if (status === 429) {
    throw new IpBlocked(videoId);
  }
  if (status < 200 || status >= 300) {
    throw new YouTubeRequestFailed(videoId, `HTTP ${status}: ${statusText}`);
  }
}

export class Transcript {
  readonly videoId: string;
  readonly language: string;
  readonly languageCode: string;
  readonly isGenerated: boolean;
  readonly translationLanguages: TranslationLanguage[];
  private readonly httpClient: IHttpClient;
  private readonly url: string;

  constructor(
    httpClient: IHttpClient,
    videoId: string,
    url: string,
    language: string,
    languageCode: string,
    isGenerated: boolean,
    translationLanguages: TranslationLanguage[],
  ) {
    this.httpClient = httpClient;
    this.videoId = videoId;
    this.url = url;
    this.language = language;
    this.languageCode = languageCode;
    this.isGenerated = isGenerated;
    this.translationLanguages = translationLanguages;
  }

  async fetch(
    preserveFormatting = false,
  ): Promise<FetchedTranscript> {
    if (this.url.includes("&exp=xpe")) {
      throw new PoTokenRequired(this.videoId);
    }
    const response = await this.httpClient.get(this.url);
    raiseForStatus(response.status, response.text.slice(0, 200), this.videoId);
    const snippets = new TranscriptParser({
      preserveFormatting,
    }).parse(response.text);
    return createFetchedTranscript(
      snippets,
      this.videoId,
      this.language,
      this.languageCode,
      this.isGenerated,
    );
  }

  toString(): string {
    return `${this.languageCode} ("${this.language}")${this.isTranslatable ? "[TRANSLATABLE]" : ""}`;
  }

  get isTranslatable(): boolean {
    return this.translationLanguages.length > 0;
  }

  translate(languageCode: string): Transcript {
    if (!this.isTranslatable) {
      throw new NotTranslatable(this.videoId);
    }
    const target = this.translationLanguages.find(
      (l) => l.languageCode === languageCode,
    );
    if (!target) {
      throw new TranslationLanguageNotAvailable(this.videoId);
    }
    return new Transcript(
      this.httpClient,
      this.videoId,
      `${this.url}&tlang=${languageCode}`,
      target.language,
      languageCode,
      true,
      [],
    );
  }
}

export class TranscriptList {
  readonly videoId: string;
  private readonly manuallyCreatedTranscripts: Map<string, Transcript>;
  private readonly generatedTranscripts: Map<string, Transcript>;
  private readonly translationLanguages: TranslationLanguage[];

  constructor(
    videoId: string,
    manuallyCreatedTranscripts: Map<string, Transcript>,
    generatedTranscripts: Map<string, Transcript>,
    translationLanguages: TranslationLanguage[],
  ) {
    this.videoId = videoId;
    this.manuallyCreatedTranscripts = manuallyCreatedTranscripts;
    this.generatedTranscripts = generatedTranscripts;
    this.translationLanguages = translationLanguages;
  }

  static build(
    httpClient: IHttpClient,
    videoId: string,
    captionsJson: CaptionsJson,
  ): TranscriptList {
    const translationLanguages: TranslationLanguage[] = (
      captionsJson.translationLanguages ?? []
    ).map((t) => ({
      language: t.languageName.runs[0]?.text ?? t.languageCode,
      languageCode: t.languageCode,
    }));

    const manuallyCreated = new Map<string, Transcript>();
    const generated = new Map<string, Transcript>();

    for (const caption of captionsJson.captionTracks) {
      const target = caption.kind === "asr" ? generated : manuallyCreated;
      target.set(
        caption.languageCode,
        new Transcript(
          httpClient,
          videoId,
          caption.baseUrl.replace("&fmt=srv3", ""),
          caption.name.runs[0]?.text ?? caption.languageCode,
          caption.languageCode,
          caption.kind === "asr",
          caption.isTranslatable ? translationLanguages : [],
        ),
      );
    }

    return new TranscriptList(
      videoId,
      manuallyCreated,
      generated,
      translationLanguages,
    );
  }

  *[Symbol.iterator](): IterableIterator<Transcript> {
    yield* this.manuallyCreatedTranscripts.values();
    yield* this.generatedTranscripts.values();
  }

  findTranscript(languageCodes: Iterable<string>): Transcript {
    return this.findTranscriptIn(
      languageCodes,
      [this.manuallyCreatedTranscripts, this.generatedTranscripts],
    );
  }

  findGeneratedTranscript(languageCodes: Iterable<string>): Transcript {
    return this.findTranscriptIn(languageCodes, [this.generatedTranscripts]);
  }

  findManuallyCreatedTranscript(
    languageCodes: Iterable<string>,
  ): Transcript {
    return this.findTranscriptIn(languageCodes, [
      this.manuallyCreatedTranscripts,
    ]);
  }

  private findTranscriptIn(
    languageCodes: Iterable<string>,
    dicts: Array<Map<string, Transcript>>,
  ): Transcript {
    for (const code of languageCodes) {
      for (const dict of dicts) {
        const transcript = dict.get(code);
        if (transcript) return transcript;
      }
    }
    throw new NoTranscriptFound(this.videoId, languageCodes, this.toString());
  }

  toString(): string {
    const describe = (items: Iterable<string>): string => {
      const lines = [...items].map((t) => ` - ${t}`);
      return lines.length > 0 ? lines.join("\n") : "None";
    };
    return (
      `For this video (${this.videoId}) transcripts are available in the following languages:\n\n` +
      `(MANUALLY CREATED)\n${describe([...this.manuallyCreatedTranscripts.values()].map((t) => t.toString()))}\n\n` +
      `(GENERATED)\n${describe([...this.generatedTranscripts.values()].map((t) => t.toString()))}\n\n` +
      `(TRANSLATION LANGUAGES)\n${describe(this.translationLanguages.map((l) => `${l.languageCode} ("${l.language}")`))}`
    );
  }
}

export interface CaptionTrackJson {
  baseUrl: string;
  name: { runs: Array<{ text: string }> };
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
}

export interface CaptionsJson {
  captionTracks: CaptionTrackJson[];
  translationLanguages?: Array<{
    languageCode: string;
    languageName: { runs: Array<{ text: string }> };
  }>;
}

interface PlayabilityStatusData {
  status?: string;
  reason?: string;
  errorScreen?: {
    playerErrorMessageRenderer?: {
      subreason?: { runs?: Array<{ text?: string }> };
    };
  };
}

export class TranscriptListFetcher {
  private readonly httpClient: IHttpClient;
  private readonly proxyConfig: ProxyConfig | null;

  constructor(httpClient: IHttpClient, proxyConfig?: ProxyConfig | null) {
    this.httpClient = httpClient;
    this.proxyConfig = proxyConfig ?? null;
  }

  async fetch(videoId: string): Promise<TranscriptList> {
    return TranscriptList.build(
      this.httpClient,
      videoId,
      await this.fetchCaptionsJson(videoId),
    );
  }

  private async fetchCaptionsJson(
    videoId: string,
    tryNumber = 0,
  ): Promise<CaptionsJson> {
    try {
      const html = await this.fetchVideoHtml(videoId);
      const apiKey = this.extractInnertubeApiKey(html, videoId);
      const innertubeData = await this.fetchInnertubeData(videoId, apiKey);
      return this.extractCaptionsJson(
        innertubeData as Record<string, unknown>,
        videoId,
      );
    } catch (error) {
      if (error instanceof RequestBlocked) {
        const retries = this.proxyConfig?.retriesWhenBlocked ?? 0;
        if (tryNumber + 1 < retries) {
          return this.fetchCaptionsJson(videoId, tryNumber + 1);
        }
        throw error.withProxyConfig(this.proxyConfig);
      }
      throw error;
    }
  }

  private extractInnertubeApiKey(html: string, videoId: string): string {
    const match = /"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/.exec(html);
    if (match?.[1]) return match[1];
    if (html.includes('class="g-recaptcha"')) {
      throw new IpBlocked(videoId);
    }
    throw new YouTubeDataUnparsable(videoId);
  }

  private extractCaptionsJson(
    innertubeData: Record<string, unknown>,
    videoId: string,
  ): CaptionsJson {
    this.assertPlayability(
      (innertubeData["playabilityStatus"] ?? {}) as PlayabilityStatusData,
      videoId,
    );
    const captions = innertubeData["captions"] as
      | { playerCaptionsTracklistRenderer?: CaptionsJson }
      | undefined;
    const captionsJson = captions?.playerCaptionsTracklistRenderer;
    if (!captionsJson || !("captionTracks" in captionsJson)) {
      throw new TranscriptsDisabled(videoId);
    }
    return captionsJson;
  }

  private assertPlayability(
    status: PlayabilityStatusData,
    videoId: string,
  ): void {
    const playabilityStatus = status.status;
    if (
      playabilityStatus !== PlayabilityStatus.OK &&
      playabilityStatus != null
    ) {
      const reason = status.reason;
      if (playabilityStatus === PlayabilityStatus.LOGIN_REQUIRED) {
        if (reason === PlayabilityFailedReason.BOT_DETECTED) {
          throw new RequestBlocked(videoId);
        }
        if (reason === PlayabilityFailedReason.AGE_RESTRICTED) {
          throw new AgeRestricted(videoId);
        }
      }
      if (
        playabilityStatus === PlayabilityStatus.ERROR &&
        reason === PlayabilityFailedReason.VIDEO_UNAVAILABLE
      ) {
        if (
          videoId.startsWith("http://") ||
          videoId.startsWith("https://")
        ) {
          throw new InvalidVideoId(videoId);
        }
        throw new VideoUnavailable(videoId);
      }
      const subreasons =
        status.errorScreen?.playerErrorMessageRenderer?.subreason?.runs ?? [];
      throw new VideoUnplayable(
        videoId,
        reason ?? null,
        subreasons.map((run) => run.text ?? ""),
      );
    }
  }

  private createConsentCookie(html: string, videoId: string): void {
    const match = /name="v" value="(.*?)"/.exec(html);
    if (!match?.[1]) {
      throw new FailedToCreateConsentCookie(videoId);
    }
    const client = this.httpClient as unknown as {
      setCookie?: (name: string, value: string) => void;
    };
    if (typeof client.setCookie === "function") {
      client.setCookie("CONSENT", `YES+${match[1]}`);
    }
  }

  private async fetchVideoHtml(videoId: string): Promise<string> {
    let html = await this.fetchHtml(videoId);
    if (html.includes('action="https://consent.youtube.com/s"')) {
      this.createConsentCookie(html, videoId);
      html = await this.fetchHtml(videoId);
      if (html.includes('action="https://consent.youtube.com/s"')) {
        throw new FailedToCreateConsentCookie(videoId);
      }
    }
    return html;
  }

  private async fetchHtml(videoId: string): Promise<string> {
    const response = await this.httpClient.get(
      WATCH_URL.replace("{video_id}", videoId),
    );
    raiseForStatus(response.status, response.text.slice(0, 200), videoId);
    return decodeHtmlEntities(response.text);
  }

  private async fetchInnertubeData(
    videoId: string,
    apiKey: string,
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      INNERTUBE_API_URL.replace("{api_key}", apiKey),
      { context: INNERTUBE_CONTEXT, videoId },
    );
    raiseForStatus(response.status, response.text.slice(0, 200), videoId);
    return response.json();
  }
}

const FORMATTING_TAGS = [
  "strong",
  "em",
  "b",
  "i",
  "mark",
  "small",
  "del",
  "ins",
  "sub",
  "sup",
];

export class TranscriptParser {
  private readonly htmlRegex: RegExp;

  constructor(options: { preserveFormatting?: boolean } = {}) {
    const { preserveFormatting = false } = options;
    if (preserveFormatting) {
      const formats = FORMATTING_TAGS.join("|");
      this.htmlRegex = new RegExp(
        `<\\/?(?!\\/?(${formats})\\b).*?\\b>`,
        "gi",
      );
    } else {
      this.htmlRegex = /<[^>]*>/gi;
    }
  }

  parse(rawData: string): FetchedTranscriptSnippet[] {
    const snippets: FetchedTranscriptSnippet[] = [];
    // timedtext responses are XML like: <transcript><text start=".." dur="..">..</text>…</transcript>
    const textTag = /<text([^>]*)>([\s\S]*?)<\/text>/gi;
    let match: RegExpExecArray | null;
    while ((match = textTag.exec(rawData)) !== null) {
      const attrs = match[1] ?? "";
      const inner = match[2] ?? "";
      if (inner.trim() === "") continue;
      const startMatch = /start="([\d.]+)"/.exec(attrs);
      const durMatch = /dur="([\d.]+)"/.exec(attrs);
      // Timedtext payloads are double-escaped (XML layer + HTML layer, e.g.
      // `&amp;#39;`), so decode repeatedly until stable.
      let text = inner;
      for (let d = 0; d < 3; d++) {
        const decoded = decodeHtmlEntities(text);
        if (decoded === text) break;
        text = decoded;
      }
      text = text.replace(this.htmlRegex, "");
      if (text === "") continue;
      snippets.push({
        text,
        start: startMatch?.[1] ? parseFloat(startMatch[1]) : 0,
        duration: durMatch?.[1] ? parseFloat(durMatch[1]) : 0,
      });
    }
    return snippets;
  }
}
