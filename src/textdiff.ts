/**
 * A small unified line diff for code fields (SQL, JS, CSS, ...). Lines are split
 * on \n or \r\n, so a change of line endings alone gives no lines.
 */

/** Past this many cells in the comparison table, the differing middle is shown as replaced outright. */
const MAX_CELLS = 4_000_000;

type Op = [" " | "-" | "+", string];

function diffOps(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;

  const head: Op[] = a.slice(0, start).map((l) => [" ", l]);
  const tail: Op[] = a.slice(endA).map((l) => [" ", l]);
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  const n = ma.length;
  const m = mb.length;
  if (n * m > MAX_CELLS) {
    return [...head, ...ma.map((l): Op => ["-", l]), ...mb.map((l): Op => ["+", l]), ...tail];
  }

  // lcs[i * (m + 1) + j] = length of the longest common subsequence of ma[i:] and mb[j:].
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = ma[i] === mb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const mid: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ma[i] === mb[j]) mid.push([" ", ma[i++]]), j++;
    else if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) mid.push(["+", mb[j++]]);
    else mid.push(["-", ma[i++]]);
  }
  // Show removals before additions within each run of changes.
  for (let k = 0; k < mid.length; ) {
    if (mid[k][0] === " ") {
      k++;
      continue;
    }
    let end = k;
    while (end < mid.length && mid[end][0] !== " ") end++;
    const run = mid.slice(k, end);
    mid.splice(k, run.length, ...run.filter((o) => o[0] === "-"), ...run.filter((o) => o[0] === "+"));
    k = end;
  }
  return [...head, ...mid, ...tail];
}

/** Unified diff hunks ("@@ -a,b +c,d @@" then " ", "-" and "+" lines) with `context` lines around changes. */
export function lineDiff(before: string, after: string, context = 3): string[] {
  const ops = diffOps(before.split(/\r?\n/), after.split(/\r?\n/));
  const changed = ops.map((o, k) => (o[0] === " " ? -1 : k)).filter((k) => k >= 0);
  if (!changed.length) return [];

  const out: string[] = [];
  let k = 0;
  while (k < changed.length) {
    const from = Math.max(0, changed[k] - context);
    let to = Math.min(ops.length, changed[k] + context + 1);
    while (k + 1 < changed.length && changed[k + 1] - context <= to) to = Math.min(ops.length, changed[++k] + context + 1);
    k++;

    let lineA = 1;
    let lineB = 1;
    for (let x = 0; x < from; x++) {
      if (ops[x][0] !== "+") lineA++;
      if (ops[x][0] !== "-") lineB++;
    }
    const hunk = ops.slice(from, to);
    const countA = hunk.filter((o) => o[0] !== "+").length;
    const countB = hunk.filter((o) => o[0] !== "-").length;
    out.push(`@@ -${countA ? lineA : lineA - 1},${countA} +${countB ? lineB : lineB - 1},${countB} @@`);
    for (const [sign, text] of hunk) out.push(sign + text);
  }
  return out;
}
