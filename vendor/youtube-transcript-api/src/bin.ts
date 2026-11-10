#!/usr/bin/env node
import { YouTubeTranscriptCli } from "./cli.js";

const cli = new YouTubeTranscriptCli(process.argv.slice(2));
try {
  const output = await cli.run();
  if (output) console.log(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
