# youtube-transcript-api

Fetch transcripts/subtitles for YouTube videos (including auto-generated ones) without a headless browser.

## Install

```bash
npm install youtube-transcript-api
```

## Usage

```ts
import { YouTubeTranscriptApi } from "youtube-transcript-api";

const api = new YouTubeTranscriptApi();

// Shortcut: fetch one transcript
const transcript = await api.fetch("dQw4w9WgXcQ", ["en"]);
for (const snippet of transcript) {
  console.log(snippet.start, snippet.duration, snippet.text);
}

// List all available transcripts
const list = await api.list("dQw4w9WgXcQ");
for (const t of list) {
  console.log(t.languageCode, t.language, t.isGenerated);
}

// Filter + translate
const de = list.findTranscript(["de", "en"]);
const translated = de.translate("en");
const fetched = await translated.fetch();
```

### Proxies (working around IP blocks)

```ts
import {
  YouTubeTranscriptApi,
  GenericProxyConfig,
  WebshareProxyConfig,
} from "youtube-transcript-api";

const api = new YouTubeTranscriptApi({
  proxyConfig: new GenericProxyConfig("http://my-proxy:8080"),
  // or:
  // proxyConfig: new WebshareProxyConfig({ proxyUsername: "user", proxyPassword: "pw" }),
});
```

You can also inject your own HTTP client (must implement `get(url)` / `post(url, body)` returning `{ status, text, json() }`):

```ts
const api = new YouTubeTranscriptApi({ httpClient: myClient });
```

## Formatters

```ts
import { FormatterLoader } from "youtube-transcript-api";

const transcript = await api.fetch("dQw4w9WgXcQ");
console.log(new FormatterLoader().load("srt").formatTranscript(transcript));
// formats: json | pretty | text | srt | webvtt
```

## CLI

```bash
npx youtube-transcript-api dQw4w9WgXcQ --languages en de --format srt
npx youtube-transcript-api dQw4w9WgXcQ --list-transcripts
```

## API reference

- `new YouTubeTranscriptApi({ proxyConfig?, httpClient? })`
  - `fetch(videoId, languages = ["en"], preserveFormatting = false)` — shortcut for list → find → fetch
  - `list(videoId)` — returns a `TranscriptList`
- `TranscriptList` — iterable; `findTranscript(codes)`, `findGeneratedTranscript(codes)`, `findManuallyCreatedTranscript(codes)`
- `Transcript` — `fetch(preserveFormatting?)`, `translate(languageCode)`, `isTranslatable`, metadata (`videoId`, `language`, `languageCode`, `isGenerated`, `translationLanguages`)
- Errors (all extend `YouTubeTranscriptApiException`): `TranscriptsDisabled`, `NoTranscriptFound`, `VideoUnavailable`, `VideoUnplayable`, `IpBlocked`, `RequestBlocked`, `NotTranslatable`, `TranslationLanguageNotAvailable`, `FailedToCreateConsentCookie`, `YouTubeRequestFailed`, `InvalidVideoId`, `AgeRestricted`, `YouTubeDataUnparsable`, `PoTokenRequired`

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node --test dist/tests/*.test.js
```

## License

MIT
