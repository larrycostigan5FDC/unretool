/**
 * Minimal Transit-JSON codec for Retool appState strings (a port of
 * PdoxLetters' scripts/transit.py, producing the same files).
 *
 * Decoding expands the Transit write cache ("^0", "^1?", ...) and converts
 * structures into plain JSON:
 *
 *   ["^ ", k1, v1, ...] maps        -> JSON objects (key order preserved)
 *   ["~#tag", value] tagged values  -> {"~#tag": value}
 *   scalar strings                  -> kept verbatim (e.g. "~m1759583917404")
 *
 * Because Transit escapes literal strings that begin with "~" (as "~~"), a
 * decoded object whose only key starts with "~#" is always a tagged value.
 *
 * Immutable.js maps (~#iM / ~#iOM) are stored by Retool as a flat
 * [k1, v1, k2, v2, ...] list; when every key is a unique string they are
 * decoded to {"~#iM": {k1: v1, ...}} for readability and flattened again on
 * encode.
 *
 * Encoding reverses this and re-applies the cache exactly as transit-js does,
 * so encode(decode(s)) === s for Retool exports.
 */
import { isObject, parseJson, stringifyJson, type Json, type JsonObject } from "./json.js";

const MAP_MARKER = "^ ";
const CACHE_PREFIX = "^";
const BASE_CHAR = 48;
const CACHE_DIGITS = 44;
const MAX_CACHE = CACHE_DIGITS * CACHE_DIGITS;
const MIN_CACHEABLE = 4;
const FLAT_MAP_TAGS = new Set(["~#iM", "~#iOM"]);

const cacheable = (s: string, asKey: boolean) =>
  s.length >= MIN_CACHEABLE && (asKey || (s[0] === "~" && ":$#".includes(s[1])));

const isCacheRef = (s: string) => s.length > 1 && s[0] === CACHE_PREFIX && s !== MAP_MARKER;

function codeToIndex(code: string): number {
  if (code.length === 2) return code.charCodeAt(1) - BASE_CHAR;
  return (code.charCodeAt(1) - BASE_CHAR) * CACHE_DIGITS + (code.charCodeAt(2) - BASE_CHAR);
}

function indexToCode(i: number): string {
  const hi = Math.floor(i / CACHE_DIGITS);
  const lo = i % CACHE_DIGITS;
  if (hi === 0) return CACHE_PREFIX + String.fromCharCode(lo + BASE_CHAR);
  return CACHE_PREFIX + String.fromCharCode(hi + BASE_CHAR) + String.fromCharCode(lo + BASE_CHAR);
}

const isTagged = (v: JsonObject): boolean => v.size === 1 && v.keys().next().value!.startsWith("~#");

function isFlatStringMap(v: Json): v is Json[] {
  if (!Array.isArray(v) || v.length % 2) return false;
  const keys = new Set<string>();
  for (let i = 0; i < v.length; i += 2) {
    const k = v[i];
    if (typeof k !== "string" || keys.has(k)) return false;
    keys.add(k);
  }
  return true;
}

class ReadCache {
  private items: string[] = [];
  read(s: string, asKey: boolean): string {
    if (isCacheRef(s)) {
      const i = codeToIndex(s);
      if (i >= this.items.length) throw new Error(`Transit cache reference ${JSON.stringify(s)} is not in the cache`);
      return this.items[i];
    }
    if (cacheable(s, asKey)) {
      if (this.items.length === MAX_CACHE) this.items = [];
      this.items.push(s);
    }
    return s;
  }
}

class WriteCache {
  private index = new Map<string, string>();
  write(s: string, asKey: boolean): string {
    if (!cacheable(s, asKey)) return s;
    const code = this.index.get(s);
    if (code !== undefined) return code;
    if (this.index.size === MAX_CACHE) this.index = new Map();
    this.index.set(s, indexToCode(this.index.size));
    return s;
  }
}

function decodeNode(node: Json, cache: ReadCache, asKey = false): Json {
  if (typeof node === "string") return cache.read(node, asKey);
  if (Array.isArray(node)) {
    if (node.length === 0) return [];
    const first = node[0];
    if (typeof first === "string") {
      if (first === MAP_MARKER) {
        const out: JsonObject = new Map();
        for (let i = 1; i < node.length; i += 2) {
          const k = decodeNode(node[i], cache, true);
          if (typeof k !== "string") throw new Error(`Non-string map key not supported: ${stringifyJson(k)}`);
          if (i + 1 >= node.length) throw new Error(`Transit map has a key with no value: ${JSON.stringify(k)}`);
          out.set(k, decodeNode(node[i + 1], cache));
        }
        return out;
      }
      if (node.length === 2) {
        const tag = cache.read(first, false);
        if (tag.startsWith("~#")) {
          let value = decodeNode(node[1], cache);
          if (FLAT_MAP_TAGS.has(tag) && isFlatStringMap(value)) {
            const map: JsonObject = new Map();
            for (let i = 0; i < value.length; i += 2) map.set(value[i] as string, value[i + 1]);
            value = map;
          }
          return new Map([[tag, value]]);
        }
        return [tag, decodeNode(node[1], cache)];
      }
      return [cache.read(first, false), ...node.slice(1).map((x) => decodeNode(x, cache))];
    }
    return node.map((x) => decodeNode(x, cache));
  }
  if (isObject(node)) {
    // Verbose-mode maps are not produced by Retool, but handle them anyway.
    const out: JsonObject = new Map();
    for (const [k, v] of node) out.set(cache.read(k, true), decodeNode(v, cache));
    return out;
  }
  return node;
}

function encodeNode(node: Json, cache: WriteCache, asKey = false): Json {
  if (typeof node === "string") return cache.write(node, asKey);
  if (Array.isArray(node)) return node.map((x) => encodeNode(x, cache));
  if (isObject(node)) {
    if (isTagged(node)) {
      const [tag, raw] = node.entries().next().value!;
      const value: Json = FLAT_MAP_TAGS.has(tag) && isObject(raw) ? [...raw].flat() : raw;
      return [cache.write(tag, false), encodeNode(value, cache)];
    }
    const out: Json[] = [MAP_MARKER];
    for (const [k, v] of node) out.push(cache.write(k, true), encodeNode(v, cache));
    return out;
  }
  return node;
}

/** Transit-JSON string -> plain JSON structure. */
export function decode(transit: string): Json {
  return decodeNode(parseJson(transit), new ReadCache());
}

/** Plain JSON structure -> compact Transit-JSON string. */
export function encode(value: Json): string {
  return stringifyJson(encodeNode(value, new WriteCache()));
}
