/**
 * Minimal HTML entity decoder covering what YouTube timedtext payloads use.
 * Avoids pulling in a dependency for `html.unescape` parity.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decode(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (entity, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = parseInt(body.slice(2), 16);
        return Number.isNaN(code) ? entity : String.fromCodePoint(code);
      }
      if (body.startsWith("#")) {
        const code = parseInt(body.slice(1), 10);
        return Number.isNaN(code) ? entity : String.fromCodePoint(code);
      }
      const named = NAMED_ENTITIES[body];
      return named !== undefined ? named : entity;
    },
  );
}
