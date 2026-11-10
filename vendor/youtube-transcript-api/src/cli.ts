import { YouTubeTranscriptApi } from "./api.js";
import { FormatterLoader, type FormatterType } from "./formatters.js";
import { GenericProxyConfig, WebshareProxyConfig } from "./proxies.js";
import type { FetchedTranscript, TranscriptList } from "./transcripts.js";

export interface CliArgs {
  videoIds: string[];
  languages: string[];
  listTranscripts: boolean;
  excludeGenerated: boolean;
  excludeManuallyCreated: boolean;
  format: string;
  translate: string;
  webshareProxyUsername?: string | null;
  webshareProxyPassword?: string | null;
  httpProxy: string;
  httpsProxy: string;
}

export class YouTubeTranscriptCli {
  private readonly args: string[];

  constructor(args: string[]) {
    this.args = args;
  }

  async run(): Promise<string> {
    const parsed = this.parseArgs(this.args);

    if (parsed.excludeManuallyCreated && parsed.excludeGenerated) {
      return "";
    }

    let proxyConfig = null;
    if (parsed.httpProxy !== "" || parsed.httpsProxy !== "") {
      proxyConfig = new GenericProxyConfig(
        parsed.httpProxy || null,
        parsed.httpsProxy || null,
      );
    }
    if (
      parsed.webshareProxyUsername != null ||
      parsed.webshareProxyPassword != null
    ) {
      proxyConfig = new WebshareProxyConfig({
        proxyUsername: parsed.webshareProxyUsername ?? "",
        proxyPassword: parsed.webshareProxyPassword ?? "",
      });
    }

    const transcripts: Array<FetchedTranscript | TranscriptList> = [];
    const exceptions: Error[] = [];
    const yttApi = new YouTubeTranscriptApi({ proxyConfig });

    for (const videoId of parsed.videoIds) {
      try {
        const transcriptList = await yttApi.list(videoId);
        if (parsed.listTranscripts) {
          transcripts.push(transcriptList);
        } else {
          transcripts.push(
            await this.fetchTranscript(parsed, transcriptList),
          );
        }
      } catch (error) {
        exceptions.push(error as Error);
      }
    }

    const sections: string[] = exceptions.map((e) => String(e));
    if (transcripts.length > 0) {
      if (parsed.listTranscripts) {
        sections.push(
          ...(transcripts as TranscriptList[]).map((t) => t.toString()),
        );
      } else {
        sections.push(
          new FormatterLoader()
            .load(parsed.format)
            .formatTranscripts(transcripts as FetchedTranscript[]),
        );
      }
    }
    return sections.join("\n\n");
  }

  private async fetchTranscript(
    parsed: CliArgs,
    transcriptList: TranscriptList,
  ): Promise<FetchedTranscript> {
    let transcript;
    if (parsed.excludeManuallyCreated) {
      transcript = transcriptList.findGeneratedTranscript(parsed.languages);
    } else if (parsed.excludeGenerated) {
      transcript = transcriptList.findManuallyCreatedTranscript(
        parsed.languages,
      );
    } else {
      transcript = transcriptList.findTranscript(parsed.languages);
    }
    if (parsed.translate) {
      transcript = transcript.translate(parsed.translate);
    }
    return transcript.fetch();
  }

  parseArgs(rawArgs: string[]): CliArgs {
    const parsed: CliArgs = {
      videoIds: [],
      languages: ["en"],
      listTranscripts: false,
      excludeGenerated: false,
      excludeManuallyCreated: false,
      format: "pretty",
      translate: "",
      webshareProxyUsername: null,
      webshareProxyPassword: null,
      httpProxy: "",
      httpsProxy: "",
    };

    const args = [...rawArgs];
    let i = 0;
    let languagesSet = false;
    while (i < args.length) {
      const arg = args[i]!;
      switch (arg) {
        case "--list-transcripts":
          parsed.listTranscripts = true;
          i++;
          break;
        case "--languages": {
          parsed.languages = [];
          languagesSet = true;
          i++;
          while (i < args.length && !args[i]!.startsWith("--")) {
            parsed.languages.push(args[i]!);
            i++;
          }
          break;
        }
        case "--exclude-generated":
          parsed.excludeGenerated = true;
          i++;
          break;
        case "--exclude-manually-created":
          parsed.excludeManuallyCreated = true;
          i++;
          break;
        case "--format":
          parsed.format = args[i + 1] ?? "pretty";
          i += 2;
          break;
        case "--translate":
          parsed.translate = args[i + 1] ?? "";
          i += 2;
          break;
        case "--webshare-proxy-username":
          parsed.webshareProxyUsername = args[i + 1] ?? null;
          i += 2;
          break;
        case "--webshare-proxy-password":
          parsed.webshareProxyPassword = args[i + 1] ?? null;
          i += 2;
          break;
        case "--http-proxy":
          parsed.httpProxy = args[i + 1] ?? "";
          i += 2;
          break;
        case "--https-proxy":
          parsed.httpsProxy = args[i + 1] ?? "";
          i += 2;
          break;
        case "--version":
          console.log(`youtube-transcript-api, version ${CLI_VERSION}`);
          process.exit(0);
          break;
        case "--help":
        case "-h":
          console.log(CLI_HELP);
          process.exit(0);
          break;
        default:
          if (arg.startsWith("--")) {
            throw new Error(`Unknown argument: ${arg}\n\n${CLI_HELP}`);
          }
          parsed.videoIds.push(arg);
          i++;
          break;
      }
    }

    if (!languagesSet && parsed.languages.length === 0) {
      parsed.languages = ["en"];
    }
    const validFormats = Object.keys(FormatterLoader.TYPES);
    if (!validFormats.includes(parsed.format)) {
      throw new Error(
        `Invalid format '${parsed.format}'. Choose one of: ${validFormats.join(", ")}`,
      );
    }
    if (parsed.videoIds.length === 0) {
      throw new Error(`No video IDs provided.\n\n${CLI_HELP}`);
    }
    return this.sanitizeVideoIds(parsed);
  }

  private sanitizeVideoIds(parsed: CliArgs): CliArgs {
    return parsed;
  }
}

export const CLI_VERSION = "0.1.0";

export const CLI_HELP = `youtube-transcript-api

Fetch transcripts/subtitles for YouTube videos (including auto-generated).

Usage:
  youtube-transcript-api <video_ids...> [options]

Options:
  --list-transcripts            List available transcript languages
  --languages <codes...>        Language codes in descending priority (default: en)
  --exclude-generated           Skip auto-generated transcripts
  --exclude-manually-created    Skip manually created transcripts
  --format <${Object.keys(FormatterLoader.TYPES).join("|")}>  Output format (default: pretty)
  --translate <code>            Translate transcript to this language code
  --webshare-proxy-username <u> Webshare proxy username
  --webshare-proxy-password <p> Webshare proxy password
  --http-proxy <URL>            HTTP proxy URL
  --https-proxy <URL>           HTTPS proxy URL
  --version                     Print version
  -h, --help                    Print this help
`;

export type { FormatterType };
