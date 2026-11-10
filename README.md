# ytbot

Telegram bot: send a YouTube link, get a summary.

## Setup

```bash
npm install
cp .env.example .env  # then fill in values
npm start
```

## Env

| Var | Required | Description |
| --- | -------- | ----------- |
| `BOT_TOKEN` | yes | Telegram bot token from @BotFather |
| `OPENROUTER_API_KEY` | yes | API key from openrouter.ai |
| `LLM_MODEL` | no | OpenRouter model id (default `openai/gpt-4o-mini`) |
| `TRANSCRIPT_LANGS` | no | Preferred transcript langs, comma-separated (default `en`) |
| `MAX_TRANSCRIPT_CHARS` | no | Max transcript chars sent to the LLM (default `12000`) |

## Usage

Send any YouTube URL (`youtube.com/watch`, `youtu.be`, `/shorts/`, …) to the bot. It fetches the transcript and replies with a TL;DR + key points.
