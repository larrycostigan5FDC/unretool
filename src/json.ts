/**
 * JSON that round-trips exactly. Plain JSON.parse can't be used here because JS
 * objects move integer-like keys ("2", "10") to the front and numbers lose their
 * original text (1e-7, big integers). Objects are Maps (insertion order, and a
 * repeated key keeps its first position but takes the last value, as in Python),
 * and numbers keep their source text.
 */
export class Num {
  constructor(readonly raw: string) {}
}

export type Json = null | boolean | string | Num | Json[] | JsonObject;
export type JsonObject = Map<string, Json>;

export const isObject = (v: unknown): v is JsonObject => v instanceof Map;

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WS = /[ \t\n\r]*/y;

export function parseJson(text: string): Json {
  let i = 0;
  const fail = (msg: string): never => {
    const before = text.slice(0, i);
    const line = before.split("\n").length;
    const col = i - before.lastIndexOf("\n");
    throw new SyntaxError(`${msg} at line ${line} column ${col}`);
  };
  const ws = () => {
    WS.lastIndex = i;
    WS.exec(text);
    i = WS.lastIndex;
  };
  const str = (): string => {
    const start = i++;
    for (;;) {
      const c = text.charCodeAt(i);
      if (Number.isNaN(c)) fail("Unterminated string");
      if (c === 0x22) break;
      i += c === 0x5c ? 2 : 1;
    }
    i++;
    try {
      return JSON.parse(text.slice(start, i)) as string;
    } catch {
      i = start;
      return fail("Invalid string");
    }
  };
  const value = (): Json => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: JsonObject = new Map();
      ws();
      if (text[i] === "}") return i++, obj;
      for (;;) {
        ws();
        if (text[i] !== '"') fail("Expected a string key");
        const key = str();
        ws();
        if (text[i++] !== ":") i--, fail("Expected ':'");
        obj.set(key, value());
        ws();
        const d = text[i++];
        if (d === "}") return obj;
        if (d !== ",") i--, fail("Expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const arr: Json[] = [];
      ws();
      if (text[i] === "]") return i++, arr;
      for (;;) {
        arr.push(value());
        ws();
        const d = text[i++];
        if (d === "]") return arr;
        if (d !== ",") i--, fail("Expected ',' or ']'");
      }
    }
    if (c === '"') return str();
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) return (i += word.length), v;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) return (i = NUMBER.lastIndex), new Num(m[0]);
    return fail(i >= text.length ? "Unexpected end of JSON" : `Unexpected character ${JSON.stringify(c)}`);
  };

  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const result = value();
  ws();
  if (i < text.length) fail("Unexpected data after JSON");
  return result;
}

/**
 * Serializes like Python's json.dumps(ensure_ascii=False): compact with
 * separators (",", ":") when indent is omitted, else indent=N.
 */
export function stringifyJson(value: Json, indent?: number): string {
  const parts: string[] = [];
  const write = (v: Json, pad: string) => {
    if (v === null || typeof v === "boolean") return void parts.push(String(v));
    if (typeof v === "string") return void parts.push(JSON.stringify(v));
    if (v instanceof Num) return void parts.push(v.raw);
    const inner = indent === undefined ? "" : pad + " ".repeat(indent);
    const open = indent === undefined ? "" : "\n" + inner;
    const sep = indent === undefined ? "," : ",\n" + inner;
    const close = indent === undefined ? "" : "\n" + pad;
    if (Array.isArray(v)) {
      if (v.length === 0) return void parts.push("[]");
      parts.push("[", open);
      v.forEach((x, n) => {
        if (n) parts.push(sep);
        write(x, inner);
      });
      return void parts.push(close, "]");
    }
    if (v.size === 0) return void parts.push("{}");
    parts.push("{", open);
    let n = 0;
    for (const [k, x] of v) {
      if (n++) parts.push(sep);
      parts.push(JSON.stringify(k), indent === undefined ? ":" : ": ");
      write(x, inner);
    }
    parts.push(close, "}");
  };
  write(value, "");
  return parts.join("");
}
