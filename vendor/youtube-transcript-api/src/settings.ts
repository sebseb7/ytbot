export const WATCH_URL = "https://www.youtube.com/watch?v={video_id}";

export const INNERTUBE_API_URL =
  "https://www.youtube.com/youtubei/v1/player?key={api_key}";

export const INNERTUBE_CONTEXT = {
  client: { clientName: "ANDROID", clientVersion: "20.10.38" },
} as const;
