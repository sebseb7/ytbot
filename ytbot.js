import "dotenv/config";
import { Bot } from "grammy";
import { YouTubeTranscriptApi } from "youtube-transcript-api";

const BOT_TOKEN = process.env.BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL =
  process.env.LLM_MODEL ??
  process.env.OPENROUTER_MODEL ??
  process.env.MODEL ??
  "openai/gpt-4o-mini";
const TRANSCRIPT_LANGS = (process.env.TRANSCRIPT_LANGS ?? "en")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_TRANSCRIPT_CHARS = Number(process.env.MAX_TRANSCRIPT_CHARS ?? 12000);

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN (or TELEGRAM_BOT_TOKEN) in .env");
  process.exit(1);
}
if (!OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY in .env");
  process.exit(1);
}

const ytApi = new YouTubeTranscriptApi();
const bot = new Bot(BOT_TOKEN);

/** Extract all YouTube video IDs from a piece of text. */
function extractVideoIds(text) {
  const ids = new Set();

  // Full URLs: youtube.com/watch?v=, /shorts/, /embed/, /live/, /v/
  const urlRe =
    /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/g;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    ids.add(m[1]);
  }

  // Bare 11-char video ID as the whole message
  const bare = text.trim().match(/^([\w-]{11})$/);
  if (bare) ids.add(bare[1]);

  return [...ids];
}

/** Fetch transcript text, preferring `langs`, falling back to any available track. */
async function getTranscriptText(videoId, langs) {
  // 1. Fast path: preferred languages (usually ["en"]).
  try {
    const t = await ytApi.fetch(videoId, langs);
    return {
      text: t.snippets.map((s) => s.text).join(" "),
      language: t.language,
      languageCode: t.languageCode,
      isGenerated: t.isGenerated,
    };
  } catch (err) {
    // NoTranscriptFound -> try fallbacks below; anything else rethrows
    // if there is no transcript list to fall back to.
    if (err?.constructor?.name !== "NoTranscriptFound") {
      // Still attempt the list-fallback for missing-transcript-ish errors,
      // otherwise surface the original error.
      const retryable = ["NoTranscriptFound", "TranscriptsDisabled"];
      if (!retryable.includes(err?.constructor?.name)) throw err;
    }
  }

  // 2. List everything and pick the first track (manual tracks come first).
  const list = await ytApi.list(videoId);
  const available = [...list];
  if (available.length === 0) throw new Error("No transcripts available.");

  // Prefer a track in one of the preferred languages, else first available.
  let track =
    available.find((t) => langs.includes(t.languageCode)) ?? available[0];

  // 3. Translate to English when possible and needed.
  if (!langs.includes(track.languageCode) && track.isTranslatable) {
    const target =
      track.translationLanguages.find((l) => langs.includes(l.languageCode))
        ?.languageCode ?? "en";
    try {
      track = track.translate(target);
    } catch {
      // fall through to fetching the original track
    }
  }

  const fetched = await track.fetch();
  return {
    text: fetched.snippets.map((s) => s.text).join(" "),
    language: fetched.language,
    languageCode: fetched.languageCode,
    isGenerated: fetched.isGenerated,
  };
}

async function summarizeWithOpenRouter(transcriptText, videoId) {
  let text = transcriptText.replace(/\s+/g, " ").trim();
  let truncated = false;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = text.slice(0, MAX_TRANSCRIPT_CHARS);
    truncated = true;
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/ytbot",
      "X-Title": "ytbot telegram summarizer",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        {
          role: "user",
          content: 'Summarize this YouTube video transcript ' + text
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter returned an empty summary.");
  return content;
}

/** Split long text into Telegram-safe chunks (<= 4096 chars). */
function splitMessage(text, max = 4000) {
  if (text.length <= max) return [text];
  const chunks = [];
  const lines = text.split("\n");
  let cur = "";
  for (const line of lines) {
    if ((cur + "\n" + line).length > max && cur) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
    // Hard-split pathological single lines
    while (cur.length > max) {
      chunks.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function friendlyTranscriptError(err) {
  const name = err?.constructor?.name ?? "";
  switch (name) {
    case "TranscriptsDisabled":
      return "Subtitles are disabled for this video.";
    case "NoTranscriptFound":
      return "No transcript found for this video (tried English + auto-translate).";
    case "VideoUnavailable":
    case "VideoUnplayable":
    case "InvalidVideoId":
      return "That video looks unavailable or the link is invalid.";
    case "AgeRestricted":
      return "That video is age-restricted and its transcript can't be fetched.";
    case "IpBlocked":
    case "RequestBlocked":
    case "YouTubeRequestFailed":
      return "YouTube blocked the transcript request. Try again later.";
    case "PoTokenRequired":
      return "YouTube demands bot-detection proof for this video; can't fetch it right now.";
    default:
      return null;
  }
}

bot.command("start", (ctx) =>
  ctx.reply(
    "Send me a YouTube link and I'll reply with a summary.\n\nExample:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ",
    { link_preview_options: { is_disabled: true } },
  ),
);

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text ?? "";
  const ids = extractVideoIds(text);
  if (ids.length === 0) {
    // Only react in private chats; stay quiet in groups unless a link is present.
    if (ctx.chat?.type === "private") {
      await ctx.reply("Send me a YouTube link and I'll summarize it. /start for help.");
    }
    return;
  }

  for (const videoId of ids) {
    const status = await ctx.reply(`⏳ Fetching transcript for ${videoId}…`);
    try {
      const t = await getTranscriptText(videoId, TRANSCRIPT_LANGS);
      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        `📝 Got transcript (${t.languageCode}${t.isGenerated ? ", auto-generated" : ""}, ${t.text.length} chars). Summarizing with ${LLM_MODEL}…`,
      );
      const summary = await summarizeWithOpenRouter(t.text, videoId);
      const header = `📺 https://youtu.be/${videoId}\n\n`;
      for (const chunk of splitMessage(header + summary)) {
        await ctx.reply(chunk, {
          link_preview_options: { is_disabled: true },
        });
      }
    } catch (err) {
      console.error(`video ${videoId}:`, err);
      const friendly =
        friendlyTranscriptError(err) ?? `Failed: ${err?.message ?? err}`;
      try {
        await ctx.api.editMessageText(ctx.chat.id, status.message_id, `❌ ${friendly}`);
      } catch {
        await ctx.reply(`❌ ${friendly}`);
      }
    }
  }
});

bot.catch((err) => console.error("Bot error:", err));

bot.start();
console.log("ytbot running…");
