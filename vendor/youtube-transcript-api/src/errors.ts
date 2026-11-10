import { WATCH_URL } from "./settings.js";
import type { ProxyConfig } from "./proxies.js";

export class YouTubeTranscriptApiException extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class CookieError extends YouTubeTranscriptApiException {}

export class CookiePathInvalid extends CookieError {
  constructor(cookiePath: string) {
    super(`Can't load the provided cookie file: ${cookiePath}`);
  }
}

export class CookieInvalid extends CookieError {
  constructor(cookiePath: string) {
    super(
      `The cookies provided are not valid (may have expired): ${cookiePath}`,
    );
  }
}

export class CouldNotRetrieveTranscript extends YouTubeTranscriptApiException {
  static ERROR_MESSAGE =
    "\nCould not retrieve a transcript for the video {video_url}!";
  static CAUSE_MESSAGE_INTRO = " This is most likely caused by:\n\n{cause}";
  static CAUSE_MESSAGE = "";
  static GITHUB_REFERRAL =
    "\n\nIf you are sure that the described cause is not responsible for this error " +
    "and that a transcript should be retrievable, please open an issue with " +
    "the version of youtube-transcript-api you are using " +
    "and the information needed to replicate the error.";

  readonly videoId: string;

  constructor(videoId: string) {
    super();
    this.videoId = videoId;
    this.message = this.buildErrorMessage();
  }

  protected get causeMessage(): string {
    return (this.constructor as typeof CouldNotRetrieveTranscript).CAUSE_MESSAGE;
  }

  private buildErrorMessage(): string {
    const ctor = this.constructor as typeof CouldNotRetrieveTranscript;
    let errorMessage = ctor.ERROR_MESSAGE.replace(
      "{video_url}",
      WATCH_URL.replace("{video_id}", this.videoId),
    );
    const cause = this.causeMessage;
    if (cause) {
      errorMessage +=
        ctor.CAUSE_MESSAGE_INTRO.replace("{cause}", cause) +
        ctor.GITHUB_REFERRAL;
    }
    return errorMessage;
  }
}

export class YouTubeDataUnparsable extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "The data required to fetch the transcript is not parsable. This should " +
    "not happen, please open an issue (make sure to include the video ID)!";
}

export class YouTubeRequestFailed extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE = "Request to YouTube failed: {reason}";
  readonly reason: string;

  constructor(videoId: string, reason: string | Error) {
    super(videoId);
    this.reason = String(reason instanceof Error ? reason.message : reason);
    this.message = this.buildMessage();
  }

  private buildMessage(): string {
    const ctor = this.constructor as typeof YouTubeRequestFailed;
    let errorMessage = CouldNotRetrieveTranscript.ERROR_MESSAGE.replace(
      "{video_url}",
      WATCH_URL.replace("{video_id}", this.videoId),
    );
    const cause = ctor.CAUSE_MESSAGE.replace("{reason}", this.reason);
    errorMessage +=
      CouldNotRetrieveTranscript.CAUSE_MESSAGE_INTRO.replace("{cause}", cause) +
      CouldNotRetrieveTranscript.GITHUB_REFERRAL;
    return errorMessage;
  }

  protected override get causeMessage(): string {
    return (this.constructor as typeof YouTubeRequestFailed).CAUSE_MESSAGE.replace(
      "{reason}",
      this.reason,
    );
  }
}

export class VideoUnplayable extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "The video is unplayable for the following reason: {reason}";
  static SUBREASON_MESSAGE = "\n\nAdditional Details:\n{sub_reasons}";

  readonly reason: string | null;
  readonly subReasons: string[];

  constructor(
    videoId: string,
    reason: string | null | undefined,
    subReasons: string[],
  ) {
    super(videoId);
    this.reason = reason ?? null;
    this.subReasons = subReasons;
    this.message = this.buildMessage();
  }

  private buildMessage(): string {
    let reason = this.reason ?? "No reason specified!";
    if (this.subReasons.length > 0) {
      const subReasons = this.subReasons.map((r) => ` - ${r}`).join("\n");
      reason += VideoUnplayable.SUBREASON_MESSAGE.replace(
        "{sub_reasons}",
        subReasons,
      );
    }
    const cause = VideoUnplayable.CAUSE_MESSAGE.replace("{reason}", reason);
    return (
      CouldNotRetrieveTranscript.ERROR_MESSAGE.replace(
        "{video_url}",
        WATCH_URL.replace("{video_id}", this.videoId),
      ) +
      CouldNotRetrieveTranscript.CAUSE_MESSAGE_INTRO.replace("{cause}", cause) +
      CouldNotRetrieveTranscript.GITHUB_REFERRAL
    );
  }

  protected override get causeMessage(): string {
    return "";
  }
}

export class VideoUnavailable extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE = "The video is no longer available";
}

export class InvalidVideoId extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "You provided an invalid video id. Make sure you are using the video id and NOT the url!\n\n" +
    'Do NOT run: `new YouTubeTranscriptApi().fetch("https://www.youtube.com/watch?v=1234")`\n' +
    'Instead run: `new YouTubeTranscriptApi().fetch("1234")`';
}

export class RequestBlocked extends CouldNotRetrieveTranscript {
  static BASE_CAUSE_MESSAGE =
    "YouTube is blocking requests from your IP. This usually is due to one of the " +
    "following reasons:\n" +
    "- You have done too many requests and your IP has been blocked by YouTube\n" +
    "- You are doing requests from an IP belonging to a cloud provider (like AWS, " +
    "Google Cloud Platform, Azure, etc.). Unfortunately, most IPs from cloud " +
    "providers are blocked by YouTube.\n\n";
  static override CAUSE_MESSAGE =
    `${RequestBlocked.BASE_CAUSE_MESSAGE}` +
    "There are two things you can do to work around this:\n" +
    "1. Use proxies to hide your IP address, as explained in the \"Working around " +
    'IP bans" section of the README.\n' +
    "2. (NOT RECOMMENDED) If you authenticate your requests using cookies, you " +
    "will be able to continue doing requests for a while. However, YouTube will " +
    "eventually permanently ban the account that you have used to authenticate " +
    "with! So only do this if you don't mind your account being banned!";
  static WITH_GENERIC_PROXY_CAUSE_MESSAGE =
    "YouTube is blocking your requests, despite you using proxies. Keep in mind " +
    "that a proxy is just a way to hide your real IP behind the IP of that proxy, " +
    "but there is no guarantee that the IP of that proxy won't be blocked as " +
    "well.\n\n" +
    "The only truly reliable way to prevent IP blocks is rotating through a large " +
    "pool of residential IPs, by using a provider like Webshare " +
    "(https://www.webshare.io/?referral_code=w0xno53eb50g), which provides you " +
    "with a pool of >30M residential IPs (make sure to purchase " +
    '"Residential" proxies, NOT "Proxy Server" or "Static Residential"!).';
  static WITH_WEBSHARE_PROXY_CAUSE_MESSAGE =
    "YouTube is blocking your requests, despite you using Webshare proxies. " +
    'Please make sure that you have purchased "Residential" proxies and ' +
    'NOT "Proxy Server" or "Static Residential", as those won\'t work as ' +
    'reliably! The free tier also uses "Proxy Server" and will NOT work!\n\n' +
    'The only reliable option is using "Residential" proxies (not "Static ' +
    'Residential"), as this allows you to rotate through a pool of over 30M IPs, ' +
    "which means you will always find an IP that hasn't been blocked by YouTube " +
    "yet!\n\n" +
    "You can support the development of this open source project by making your " +
    "Webshare purchases through this affiliate link: " +
    "https://www.webshare.io/?referral_code=w0xno53eb50g \n\n" +
    "Thank you for your support! <3";

  private proxyConfig: unknown = null;

  withProxyConfig(proxyConfig?: ProxyConfig | null): this {
    this.proxyConfig = proxyConfig ?? null;
    this.message = this.buildMessageWithProxy();
    return this;
  }

  protected override get causeMessage(): string {
    return this.resolveCause();
  }

  private resolveCause(): string {
    const ctor = this.constructor as typeof RequestBlocked;
    // Avoid importing proxy classes here (circular dep) — duck-type instead.
    const cfg = this.proxyConfig as
      | { isWebshare?: boolean; httpUrl?: string }
      | null;
    if (cfg !== null && typeof cfg === "object") {
      if (
        (cfg as { isWebshare?: boolean }).isWebshare === true ||
        (cfg as { constructor?: { name?: string } }).constructor?.name ===
          "WebshareProxyConfig"
      ) {
        return ctor.WITH_WEBSHARE_PROXY_CAUSE_MESSAGE;
      }
      return ctor.WITH_GENERIC_PROXY_CAUSE_MESSAGE;
    }
    return ctor.CAUSE_MESSAGE;
  }

  private buildMessageWithProxy(): string {
    const cause = this.resolveCause();
    return (
      CouldNotRetrieveTranscript.ERROR_MESSAGE.replace(
        "{video_url}",
        WATCH_URL.replace("{video_id}", this.videoId),
      ) +
      CouldNotRetrieveTranscript.CAUSE_MESSAGE_INTRO.replace("{cause}", cause) +
      CouldNotRetrieveTranscript.GITHUB_REFERRAL
    );
  }
}

export class IpBlocked extends RequestBlocked {
  static override CAUSE_MESSAGE =
    `${RequestBlocked.BASE_CAUSE_MESSAGE}` +
    'Ways to work around this are explained in the "Working around IP ' +
    'bans" section of the README.\n';
}

export class TranscriptsDisabled extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE = "Subtitles are disabled for this video";
}

export class AgeRestricted extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "This video is age-restricted. Therefore, you are unable to retrieve " +
    "transcripts for it without authenticating yourself.\n\n" +
    "Unfortunately, Cookie Authentication is temporarily unsupported in " +
    "youtube-transcript-api, as recent changes in YouTube's API broke the previous " +
    "implementation. I will do my best to re-implement it as soon as possible.";
}

export class NotTranslatable extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE = "The requested language is not translatable";
}

export class TranslationLanguageNotAvailable extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "The requested translation language is not available";
}

export class FailedToCreateConsentCookie extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "Failed to automatically give consent to saving cookies";
}

export class NoTranscriptFound extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "No transcripts were found for any of the requested language codes: {requested_language_codes}\n\n" +
    "{transcript_data}";

  readonly requestedLanguageCodes: string[];
  private transcriptDataDescription: string;

  constructor(
    videoId: string,
    requestedLanguageCodes: Iterable<string>,
    transcriptListDescription: string | { toString(): string },
  ) {
    super(videoId);
    this.requestedLanguageCodes = [...requestedLanguageCodes];
    this.transcriptDataDescription = String(transcriptListDescription);
    this.message = this.buildNoTranscriptMessage();
  }

  private buildNoTranscriptMessage(): string {
    const cause = NoTranscriptFound.CAUSE_MESSAGE.replace(
      "{requested_language_codes}",
      this.requestedLanguageCodes.join(", "),
    ).replace("{transcript_data}", this.transcriptDataDescription);
    return (
      CouldNotRetrieveTranscript.ERROR_MESSAGE.replace(
        "{video_url}",
        WATCH_URL.replace("{video_id}", this.videoId),
      ) +
      CouldNotRetrieveTranscript.CAUSE_MESSAGE_INTRO.replace("{cause}", cause) +
      CouldNotRetrieveTranscript.GITHUB_REFERRAL
    );
  }

  protected override get causeMessage(): string {
    return "";
  }
}

export class PoTokenRequired extends CouldNotRetrieveTranscript {
  static override CAUSE_MESSAGE =
    "The requested video cannot be retrieved without a PO Token. If this happens, " +
    "please open a GitHub issue!";
}
