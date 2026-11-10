import type { ProxyConfig } from "./proxies.js";
import { DefaultHttpClient, type IHttpClient } from "./http.js";
import {
  TranscriptListFetcher,
  type FetchedTranscript,
  type TranscriptList,
} from "./transcripts.js";

export interface YouTubeTranscriptApiOptions {
  proxyConfig?: ProxyConfig | null;
  httpClient?: IHttpClient | null;
}

export class YouTubeTranscriptApi {
  private readonly fetcher: TranscriptListFetcher;

  constructor(options: YouTubeTranscriptApiOptions = {}) {
    const { proxyConfig = null, httpClient = null } = options;
    let client: IHttpClient;
    if (httpClient) {
      client = httpClient;
    } else {
      client = new DefaultHttpClient({ proxyConfig });
    }
    this.fetcher = new TranscriptListFetcher(client, proxyConfig);
  }

  /**
   * Shortcut for `list(videoId).findTranscript(languages).fetch()`.
   * @param videoId the video ID (NOT the full URL)
   * @param languages language codes in descending priority, defaults to `["en"]`
   */
  async fetch(
    videoId: string,
    languages: Iterable<string> = ["en"],
    preserveFormatting = false,
  ): Promise<FetchedTranscript> {
    const list = await this.list(videoId);
    const transcript = list.findTranscript(languages);
    return transcript.fetch(preserveFormatting);
  }

  /** Retrieve the list of transcripts available for a video. */
  async list(videoId: string): Promise<TranscriptList> {
    return this.fetcher.fetch(videoId);
  }
}
