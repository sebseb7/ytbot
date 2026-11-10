import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JSONFormatter,
  SRTFormatter,
  TextFormatter,
  WebVTTFormatter,
  FormatterLoader,
} from "../formatters.js";
import { TranscriptParser, TranscriptList } from "../transcripts.js";
import type { IHttpClient } from "../http.js";
import {
  GenericProxyConfig,
  WebshareProxyConfig,
  InvalidProxyConfig,
} from "../proxies.js";
import { NoTranscriptFound } from "../errors.js";
import { decode } from "../entities.js";

const SNIPPETS = [
  { text: "Hello world", start: 0.0, duration: 1.5 },
  { text: "Second line", start: 1.5, duration: 2.0 },
];

function fetchedTranscript() {
  return {
    snippets: SNIPPETS,
    videoId: "abc",
    language: "English",
    languageCode: "en",
    isGenerated: false,
    toRawData: () => SNIPPETS.map((s) => ({ ...s })),
    *[Symbol.iterator]() {
      yield* SNIPPETS;
    },
  };
}

describe("formatters", () => {
  it("TextFormatter joins lines", () => {
    assert.equal(
      new TextFormatter().formatTranscript(fetchedTranscript()),
      "Hello world\nSecond line",
    );
  });

  it("JSONFormatter round-trips", () => {
    const out = new JSONFormatter().formatTranscript(fetchedTranscript());
    assert.deepEqual(JSON.parse(out), SNIPPETS);
  });

  it("SRTFormatter output", () => {
    const out = new SRTFormatter().formatTranscript(fetchedTranscript());
    assert.equal(
      out,
      "1\n00:00:00,000 --> 00:00:01,500\nHello world\n\n2\n00:00:01,500 --> 00:00:03,500\nSecond line\n",
    );
  });

  it("WebVTTFormatter output", () => {
    const out = new WebVTTFormatter().formatTranscript(fetchedTranscript());
    assert.ok(out.startsWith("WEBVTT\n\n"));
    assert.ok(out.includes("00:00:00.000 --> 00:00:01.500"));
  });

  it("FormatterLoader rejects unknown types", () => {
    assert.throws(() => new FormatterLoader().load("nope"), /not supported/);
  });
});

describe("TranscriptParser", () => {
  it("parses timedtext xml and strips tags", () => {
    const xml =
      `<transcript><text start="0.0" dur="1.0">Hello &amp; <b>world</b></text>` +
      `<text start="1.0" dur="2.0">Second</text></transcript>`;
    const snippets = new TranscriptParser().parse(xml);
    assert.deepEqual(snippets, [
      { text: "Hello & world", start: 0, duration: 1 },
      { text: "Second", start: 1, duration: 2 },
    ]);
  });

  it("preserveFormatting keeps allowed tags", () => {
    const xml =
      `<transcript><text start="0" dur="1"><b>bold</b><script>evil</script></text></transcript>`;
    const snippets = new TranscriptParser({
      preserveFormatting: true,
    }).parse(xml);
    assert.equal(snippets[0]!.text, "<b>bold</b>evil");
  });
});

describe("entities decode", () => {
  it("decodes named, decimal and hex entities", () => {
    assert.equal(decode("&amp;&lt;&gt;"), "&<>");
    assert.equal(decode("&#65;"), "A");
    assert.equal(decode("&#x41;"), "A");
    assert.equal(decode("no entities"), "no entities");
  });
});

describe("proxies", () => {
  it("GenericProxyConfig requires at least one url", () => {
    assert.throws(() => new GenericProxyConfig(), InvalidProxyConfig);
    const cfg = new GenericProxyConfig("http://h:8080");
    assert.equal(cfg.toRequestsDict().https, "http://h:8080");
  });

  it("WebshareProxyConfig builds rotating url", () => {
    const cfg = new WebshareProxyConfig({
      proxyUsername: "user-rotate",
      proxyPassword: "pw",
      filterIpLocations: ["de", "us"],
    });
    assert.ok(cfg.url.includes("user-DE-US-rotate"));
    assert.equal(cfg.retriesWhenBlocked, 10);
    assert.equal(cfg.preventKeepingConnectionsAlive, true);
  });
});

describe("TranscriptList", () => {
  const fakeClient = {
    get: async () => ({ status: 200, text: "", json: () => ({}) }),
    post: async () => ({ status: 200, text: "", json: () => ({}) }),
  } satisfies IHttpClient;

  function buildList() {
    return TranscriptList.build(fakeClient, "vid", {
      captionTracks: [
        {
          baseUrl: "https://example.com/manual&fmt=srv3",
          name: { runs: [{ text: "English" }] },
          languageCode: "en",
          isTranslatable: true,
        },
        {
          baseUrl: "https://example.com/auto",
          name: { runs: [{ text: "English (auto)" }] },
          languageCode: "en",
          kind: "asr",
        },
      ],
      translationLanguages: [
        { languageCode: "de", languageName: { runs: [{ text: "German" }] } },
      ],
    });
  }

  it("prefers manually created transcripts", () => {
    const list = buildList();
    const t = list.findTranscript(["en"]);
    assert.equal(t.isGenerated, false);
    assert.equal([...list].length, 2);
  });

  it("throws NoTranscriptFound with helpful message", () => {
    const list = buildList();
    assert.throws(() => list.findTranscript(["fr"]), NoTranscriptFound);
  });

  it("translate appends tlang", () => {
    const list = buildList();
    const translated = list.findTranscript(["en"]).translate("de");
    assert.equal(translated.languageCode, "de");
  });
});
