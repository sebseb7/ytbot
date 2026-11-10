import type {
  FetchedTranscript,
  FetchedTranscriptSnippet,
} from "./transcripts.js";

export abstract class Formatter {
  abstract formatTranscript(transcript: FetchedTranscript): string;
  abstract formatTranscripts(transcripts: FetchedTranscript[]): string;
}

export class PrettyPrintFormatter extends Formatter {
  override formatTranscript(transcript: FetchedTranscript): string {
    return inspect(transcript.toRawData());
  }

  override formatTranscripts(transcripts: FetchedTranscript[]): string {
    return inspect(transcripts.map((t) => t.toRawData()));
  }
}

function inspect(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

export class JSONFormatter extends Formatter {
  override formatTranscript(transcript: FetchedTranscript): string {
    return JSON.stringify(transcript.toRawData());
  }

  override formatTranscripts(transcripts: FetchedTranscript[]): string {
    return JSON.stringify(transcripts.map((t) => t.toRawData()));
  }
}

export class TextFormatter extends Formatter {
  override formatTranscript(transcript: FetchedTranscript): string {
    return transcript.snippets.map((line) => line.text).join("\n");
  }

  override formatTranscripts(transcripts: FetchedTranscript[]): string {
    return transcripts.map((t) => this.formatTranscript(t)).join("\n\n\n");
  }
}

export abstract class TextBasedFormatter extends TextFormatter {
  protected abstract formatTimestamp(
    hours: number,
    mins: number,
    secs: number,
    ms: number,
  ): string;
  protected abstract formatTranscriptHeader(lines: string[]): string;
  protected abstract formatTranscriptHelper(
    index: number,
    timeText: string,
    snippet: FetchedTranscriptSnippet,
  ): string;

  protected secondsToTimestamp(time: number): string {
    const t = Number(time);
    const hoursFloat = Math.floor(t / 3600);
    const remainder = t - hoursFloat * 3600;
    const minsFloat = Math.floor(remainder / 60);
    const secsFloat = remainder - minsFloat * 60;
    const hours = hoursFloat;
    const mins = minsFloat;
    const secs = Math.floor(secsFloat);
    const ms = Math.round((t - Math.floor(t)) * 1000);
    return this.formatTimestamp(hours, mins, secs, ms);
  }

  override formatTranscript(transcript: FetchedTranscript): string {
    const lines: string[] = [];
    const snippets = transcript.snippets;
    for (let i = 0; i < snippets.length; i++) {
      const line = snippets[i]!;
      const end = line.start + line.duration;
      const next = snippets[i + 1];
      const endTime =
        next !== undefined && i < snippets.length - 1 && next.start < end
          ? next.start
          : end;
      const timeText = `${this.secondsToTimestamp(line.start)} --> ${this.secondsToTimestamp(endTime)}`;
      lines.push(this.formatTranscriptHelper(i, timeText, line));
    }
    return this.formatTranscriptHeader(lines);
  }
}

export class SRTFormatter extends TextBasedFormatter {
  protected override formatTimestamp(
    hours: number,
    mins: number,
    secs: number,
    ms: number,
  ): string {
    return `${pad(hours)}:${pad(mins)}:${pad(secs)},${padMs(ms)}`;
  }

  protected override formatTranscriptHeader(lines: string[]): string {
    return lines.join("\n\n") + "\n";
  }

  protected override formatTranscriptHelper(
    index: number,
    timeText: string,
    snippet: FetchedTranscriptSnippet,
  ): string {
    return `${index + 1}\n${timeText}\n${snippet.text}`;
  }
}

export class WebVTTFormatter extends TextBasedFormatter {
  protected override formatTimestamp(
    hours: number,
    mins: number,
    secs: number,
    ms: number,
  ): string {
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${padMs(ms)}`;
  }

  protected override formatTranscriptHeader(lines: string[]): string {
    return "WEBVTT\n\n" + lines.join("\n\n") + "\n";
  }

  protected override formatTranscriptHelper(
    _index: number,
    timeText: string,
    snippet: FetchedTranscriptSnippet,
  ): string {
    return `${timeText}\n${snippet.text}`;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function padMs(n: number): string {
  return String(n).padStart(3, "0");
}

export type FormatterType = "json" | "pretty" | "text" | "webvtt" | "srt";

export class UnknownFormatterType extends Error {
  constructor(formatterType: string) {
    super(
      `The format '${formatterType}' is not supported. Choose one of the following formats: ${Object.keys(FormatterLoader.TYPES).join(", ")}`,
    );
    this.name = "UnknownFormatterType";
  }
}

export class FormatterLoader {
  static TYPES: Record<FormatterType, new () => Formatter> = {
    json: JSONFormatter,
    pretty: PrettyPrintFormatter,
    text: TextFormatter,
    webvtt: WebVTTFormatter,
    srt: SRTFormatter,
  };

  load(formatterType: string = "pretty"): Formatter {
    const FormatterClass = (FormatterLoader.TYPES as Record<string, new () => Formatter>)[
      formatterType
    ];
    if (!FormatterClass) {
      throw new UnknownFormatterType(formatterType);
    }
    return new FormatterClass();
  }
}
