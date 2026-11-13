/**
 * Transit JSON codec for Retool appState strings.
 *
 * decodeTransit() turns a Transit string into plain JSON (layer 2 of the schema in
 * retool-classic-export.ts) plus TransitMeta: the Transit tags and key orders that
 * plain JSON can't hold. encodeTransit() reverses it. Write caching follows
 * transit-js exactly, so an unchanged value re-encodes byte-for-byte.
 *
 * Tags in TransitMeta, keyed by JSON pointer:
 *   "#iR:<name>"    Immutable Record, rep {n: name, v: fields}  -> the fields object
 *   "#iM" / "#iOM"  Immutable (Ordered)Map, rep [k1, v1, ...]   -> object
 *   "#iL" etc.      Immutable List/Set/Stack, rep [...]         -> array
 *   "#<tag>"        any other tag                               -> its decoded rep
 *   "~m"            timestamp, "~m<epoch ms>"                   -> ISO 8601 string
 *   "~<c>"          any other scalar tag, "~<c><rep>"           -> the rep string
 */

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

export interface TransitMeta {
  tags: Record<string, string>;
  /** Key order for objects whose original order JSON can't keep (integer-like keys). */
  order: Record<string, string[]>;
}

export const emptyMeta = (): TransitMeta => ({ tags: {}, order: {} });

const MAP = "^ ";
const LIST_TAGS = new Set(["iL", "iS", "iOS", "iStk"]);
const MAP_TAGS = new Set(["iM", "iOM"]);

// --- caching (mirrors transit-js caching.js) -------------------------------

const CODE_DIGITS = 44;
const BASE_CHAR = 48;
const MAX_ENTRIES = CODE_DIGITS * CODE_DIGITS;

function isCacheable(s: string, asMapKey: boolean): boolean {
  if (s.length <= 3) return false;
  if (asMapKey) return true;
  return s[0] === "~" && (s[1] === ":" || s[1] === "$" || s[1] === "#");
}

const isCacheCode = (s: string) => s[0] === "^" && s[1] !== " ";

function idxToCode(i: number): string {
  const hi = Math.floor(i / CODE_DIGITS);
  const lo = String.fromCharCode((i % CODE_DIGITS) + BASE_CHAR);
  return hi === 0 ? "^" + lo : "^" + String.fromCharCode(hi + BASE_CHAR) + lo;
}

function codeToIdx(code: string): number {
  if (code.length === 2) return code.charCodeAt(1) - BASE_CHAR;
  return (code.charCodeAt(1) - BASE_CHAR) * CODE_DIGITS + (code.charCodeAt(2) - BASE_CHAR);
}

class ReadCache {
  private idx = 0;
  private items: string[] = [];
  write(s: string) {
    if (this.idx === MAX_ENTRIES) this.idx = 0;
    this.items[this.idx++] = s;
  }
  read(code: string): string {
    const s = this.items[codeToIdx(code)];
    if (s === undefined) throw new Error(`Transit cache code ${code} used before it was defined`);
    return s;
  }
}

class WriteCache {
  private idx = 0;
  private codes = new Map<string, string>();
  write(s: string, asMapKey: boolean): string {
    if (!isCacheable(s, asMapKey)) return s;
    if (this.idx === MAX_ENTRIES) {
      this.idx = 0;
      this.codes.clear();
    }
    const code = this.codes.get(s);
    if (code !== undefined) return code;
    this.codes.set(s, idxToCode(this.idx++));
    return s;
  }
}

// --- intermediate representation -------------------------------------------

class TMap {
  constructor(readonly pairs: [Node, Node][]) {}
}
class TTagged {
  constructor(readonly tag: string, readonly rep: Node) {}
}
class TScalar {
  constructor(readonly tag: string, readonly rep: string) {}
}
class TagMarker {
  constructor(readonly tag: string) {}
}
type Node = null | boolean | number | string | Node[] | TMap | TTagged | TScalar;

// --- pointers ----------------------------------------------------------------

export const childPointer = (ptr: string, key: string | number) =>
  `${ptr}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;

function setOwn(obj: JsonObject, key: string, value: Json) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

// --- decode ------------------------------------------------------------------

export function decodeTransit(text: string): { value: Json; meta: TransitMeta } {
  const cache = new ReadCache();

  function str(s: string, asMapKey: boolean): string | TScalar | TagMarker {
    if (isCacheCode(s)) s = cache.read(s);
    else if (isCacheable(s, asMapKey)) cache.write(s);
    if (s[0] !== "~") return s;
    const c = s[1];
    if (c === "~" || c === "^" || c === "`") return s.slice(1);
    if (c === "#") return new TagMarker(s.slice(2));
    return new TScalar(c, s.slice(2));
  }

  function parse(v: unknown, asMapKey = false): Node {
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string") {
      const r = str(v, asMapKey);
      if (r instanceof TagMarker) throw new Error(`Transit tag ~#${r.tag} outside a tagged value`);
      return r;
    }
    if (Array.isArray(v)) {
      if (v[0] === MAP) {
        if (v.length % 2 === 0) throw new Error("Transit map has an odd number of entries");
        const pairs: [Node, Node][] = [];
        for (let i = 1; i < v.length; i += 2) pairs.push([parse(v[i], true), parse(v[i + 1])]);
        return new TMap(pairs);
      }
      if (v.length === 2 && typeof v[0] === "string") {
        const head = str(v[0], false);
        if (head instanceof TagMarker) return new TTagged(head.tag, parse(v[1]));
        return [head, parse(v[1])];
      }
      return v.map((x) => parse(x));
    }
    if (typeof v === "object") {
      // Verbose-mode map or tagged value.
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 1 && entries[0][0].startsWith("~#")) {
        return new TTagged(entries[0][0].slice(2), parse(entries[0][1]));
      }
      return new TMap(entries.map(([k, x]) => [parse(k, true), parse(x)]));
    }
    throw new Error(`Unexpected JSON value in Transit: ${String(v)}`);
  }

  const meta = emptyMeta();

  function tag(ptr: string, t: string) {
    if (hasOwn(meta.tags, ptr)) throw new Error(`Nested Transit tags at ${ptr || "/"} are not supported`);
    meta.tags[ptr] = t;
  }

  function toObject(pairs: [Node, Node][], ptr: string): JsonObject {
    const obj: JsonObject = {};
    const keys: string[] = [];
    for (const [k, v] of pairs) {
      if (typeof k !== "string") throw new Error(`Non-string map key at ${ptr || "/"}`);
      if (hasOwn(obj, k)) throw new Error(`Duplicate map key "${k}" at ${ptr || "/"}`);
      keys.push(k);
      setOwn(obj, k, unwrap(v, childPointer(ptr, k)));
    }
    if (Object.keys(obj).some((k, i) => k !== keys[i])) meta.order[ptr] = keys;
    return obj;
  }

  function unwrap(n: Node, ptr: string): Json {
    if (n === null || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map((x, i) => unwrap(x, childPointer(ptr, i)));
    if (n instanceof TMap) return toObject(n.pairs, ptr);
    if (n instanceof TScalar) {
      tag(ptr, "~" + n.tag);
      if (n.tag !== "m") return n.rep;
      const ms = Number(n.rep);
      const iso = Number.isSafeInteger(ms) ? new Date(ms).toISOString() : "";
      if (!iso || Date.parse(iso) !== ms) throw new Error(`Unsupported timestamp ~m${n.rep} at ${ptr || "/"}`);
      return iso;
    }
    const { tag: t, rep } = n;
    if (t === "iR") {
      const fields = rep instanceof TMap ? new Map(rep.pairs.map(([k, v]) => [k, v])) : undefined;
      const name = fields?.get("n");
      const v = fields?.get("v");
      if (fields?.size !== 2 || typeof name !== "string" || !(v instanceof TMap)) {
        throw new Error(`Unexpected Immutable Record encoding at ${ptr || "/"}`);
      }
      tag(ptr, `#iR:${name}`);
      return toObject(v.pairs, ptr);
    }
    if (MAP_TAGS.has(t) && Array.isArray(rep) && rep.length % 2 === 0) {
      tag(ptr, "#" + t);
      const pairs: [Node, Node][] = [];
      for (let i = 0; i < rep.length; i += 2) pairs.push([rep[i], rep[i + 1]]);
      return toObject(pairs, ptr);
    }
    if (LIST_TAGS.has(t) && Array.isArray(rep)) {
      tag(ptr, "#" + t);
      return rep.map((x, i) => unwrap(x, childPointer(ptr, i)));
    }
    if (MAP_TAGS.has(t) || LIST_TAGS.has(t)) throw new Error(`Unexpected ~#${t} encoding at ${ptr || "/"}`);
    tag(ptr, "#" + t);
    return unwrap(rep, ptr);
  }

  return { value: unwrap(parse(JSON.parse(text)), ""), meta };
}

// --- encode ------------------------------------------------------------------

const isObject = (v: Json): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Encodes plain JSON back to Transit using the tags and key orders in meta. A tag
 * that no longer fits its value (e.g. a record that was replaced with null) is ignored.
 */
export function encodeTransit(value: Json, meta: TransitMeta): string {
  const cache = new WriteCache();

  const keysOf = (obj: JsonObject, ptr: string) => {
    const order = meta.order[ptr];
    if (!order) return Object.keys(obj);
    const first = order.filter((k) => hasOwn(obj, k));
    return [...first, ...Object.keys(obj).filter((k) => !first.includes(k))];
  };

  const pairsOf = (obj: JsonObject, ptr: string): [Node, Node][] =>
    keysOf(obj, ptr).map((k) => [k, wrap(obj[k], childPointer(ptr, k))]);

  function wrap(v: Json, ptr: string): Node {
    const t = meta.tags[ptr];
    if (t?.startsWith("~") && typeof v === "string") {
      if (t !== "~m") return new TScalar(t.slice(1), v);
      const ms = Date.parse(v);
      if (Number.isNaN(ms)) throw new Error(`Invalid timestamp "${v}" at ${ptr || "/"}`);
      return new TScalar("m", String(ms));
    }
    if (t?.startsWith("#iR:") && isObject(v)) {
      return new TTagged("iR", new TMap([["n", t.slice(4)], ["v", new TMap(pairsOf(v, ptr))]]));
    }
    if (t && MAP_TAGS.has(t.slice(1)) && isObject(v)) {
      return new TTagged(t.slice(1), pairsOf(v, ptr).flat());
    }
    if (t && LIST_TAGS.has(t.slice(1)) && Array.isArray(v)) {
      return new TTagged(t.slice(1), v.map((x, i) => wrap(x, childPointer(ptr, i))));
    }
    const plain = plainNode(v, ptr);
    if (t?.startsWith("#") && !t.startsWith("#iR:") && !MAP_TAGS.has(t.slice(1)) && !LIST_TAGS.has(t.slice(1))) {
      return new TTagged(t.slice(1), plain);
    }
    return plain;
  }

  function plainNode(v: Json, ptr: string): Node {
    if (Array.isArray(v)) return v.map((x, i) => wrap(x, childPointer(ptr, i)));
    if (isObject(v)) return new TMap(pairsOf(v, ptr));
    return v;
  }

  const escape = (s: string) => (s[0] === "~" || s[0] === "^" || s[0] === "`" ? "~" + s : s);

  function emit(n: Node, asMapKey = false): unknown {
    if (n === null || typeof n === "boolean") return n;
    if (typeof n === "number") {
      if (!Number.isFinite(n)) return cache.write(Number.isNaN(n) ? "~zNaN" : n > 0 ? "~zINF" : "~z-INF", asMapKey);
      return n;
    }
    if (typeof n === "string") return cache.write(escape(n), asMapKey);
    if (Array.isArray(n)) return n.map((x) => emit(x));
    if (n instanceof TMap) return [MAP, ...n.pairs.flatMap(([k, v]) => [emit(k, true), emit(v)])];
    if (n instanceof TScalar) return cache.write(`~${n.tag}${n.rep}`, asMapKey);
    return [cache.write(`~#${n.tag}`, false), emit(n.rep)];
  }

  return JSON.stringify(emit(wrap(value, "")));
}

/** Entries of meta under prefix, re-rooted at "". */
export function subMeta(meta: TransitMeta, prefix: string): TransitMeta {
  const out = emptyMeta();
  const under = (p: string) => p === prefix || p.startsWith(prefix + "/");
  for (const [p, t] of Object.entries(meta.tags)) if (under(p)) out.tags[p.slice(prefix.length)] = t;
  for (const [p, o] of Object.entries(meta.order)) if (under(p)) out.order[p.slice(prefix.length)] = o;
  return out;
}

/** Copies meta's entries into target under prefix. */
export function mergeMeta(target: TransitMeta, meta: TransitMeta, prefix: string) {
  for (const [p, t] of Object.entries(meta.tags)) target.tags[prefix + p] = t;
  for (const [p, o] of Object.entries(meta.order)) target.order[prefix + p] = o;
}

/** meta without the entries under prefix. */
export function withoutMeta(meta: TransitMeta, prefix: string): TransitMeta {
  const out = emptyMeta();
  const under = (p: string) => p === prefix || p.startsWith(prefix + "/");
  for (const [p, t] of Object.entries(meta.tags)) if (!under(p)) out.tags[p] = t;
  for (const [p, o] of Object.entries(meta.order)) if (!under(p)) out.order[p] = o;
  return out;
}
