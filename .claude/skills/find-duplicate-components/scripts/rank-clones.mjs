#!/usr/bin/env node
// Deterministic mechanical pass for the find-duplicate-components skill.
// Reads a jscpd JSON report and ranks CROSS-FILE clones - the ones that mean
// "someone rebuilt this elsewhere", as opposed to in-file repetition.
//
// Usage:
//   node rank-clones.mjs <path-to-jscpd-report.json> [--json]
//
// Default output is a human/LLM-readable ranking. --json emits a compact
// machine list (one candidate cluster per file-pair) for the semantic pass
// to consume without re-reading the whole report.

import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
const asJson = process.argv.includes("--json");
if (!reportPath) {
  console.error("usage: node rank-clones.mjs <jscpd-report.json> [--json]");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const dups = report.duplicates || [];

// Normalize to a path relative to the scanned root. jscpd usually already
// stores names relative to the scan root (e.g. "organizations/detail/x.tsx");
// if an absolute path slips through, trim everything up to ".../components/".
const rel = (p) => {
  const i = p.indexOf("/components/");
  if (i >= 0) return p.slice(i + "/components/".length);
  const j = p.indexOf("/src/");
  if (j >= 0) return p.slice(j + "/src/".length);
  return p; // already root-relative - keep the full feature-folder prefix
};
// First path segment = feature folder ("deals", "quotes", "ui", "shared"...).
const feature = (relPath) => (relPath.includes("/") ? relPath.split("/")[0] : "(root)");

const crossFile = dups
  .filter((d) => d.firstFile.name !== d.secondFile.name)
  .map((d) => ({
    lines: d.lines,
    tokens: d.tokens,
    a: rel(d.firstFile.name),
    b: rel(d.secondFile.name),
    aStart: d.firstFile.start,
    bStart: d.secondFile.start,
  }));

// Aggregate every clone between the same two files into one candidate cluster.
const pairs = new Map();
for (const c of crossFile) {
  const [x, y] = [c.a, c.b].sort();
  const key = `${x}\t${y}`;
  if (!pairs.has(key)) {
    pairs.set(key, { a: x, b: y, totalLines: 0, cloneCount: 0, ranges: [], featA: feature(x), featB: feature(y) });
  }
  const p = pairs.get(key);
  p.totalLines += c.lines;
  p.cloneCount += 1;
  p.ranges.push({ aStart: c.aStart, bStart: c.bStart, lines: c.lines });
}

const ranked = [...pairs.values()].sort((p, q) => q.totalLines - p.totalLines);
for (const p of ranked) p.ranges.sort((a, b) => b.lines - a.lines);

// A pair spanning two different feature folders is a stronger "duplication
// across teams/features" signal than repetition within one folder.
const crossFeature = ranked.filter((p) => p.featA !== p.featB);

const stats = report.statistics?.total || {};

if (asJson) {
  process.stdout.write(
    JSON.stringify(
      {
        summary: {
          totalClones: dups.length,
          crossFileClones: crossFile.length,
          candidatePairs: ranked.length,
          duplicatedLines: stats.duplicatedLines,
          totalLines: stats.lines,
          percentage: stats.percentage,
        },
        // top clusters, biggest ranges first - enough for the semantic pass to
        // open exact line ranges rather than whole files
        candidates: ranked.slice(0, 40).map((p) => ({
          a: p.a,
          b: p.b,
          crossFeature: p.featA !== p.featB,
          totalSharedLines: p.totalLines,
          cloneCount: p.cloneCount,
          topRanges: p.ranges.slice(0, 4),
        })),
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

const pct = typeof stats.percentage === "number" ? stats.percentage.toFixed(1) : "?";
console.log(
  `jscpd: ${dups.length} clones (${crossFile.length} cross-file) | ` +
    `${stats.duplicatedLines}/${stats.lines} lines duplicated (${pct}%)`,
);
console.log(`candidate file-pairs: ${ranked.length} (${crossFeature.length} span two feature folders)\n`);

console.log("=== TOP CANDIDATE CLUSTERS (aggregated shared lines) ===");
console.log("Prioritize cross-feature pairs (>) - those are the 'rebuilt elsewhere' cases.\n");
for (const p of ranked.slice(0, 25)) {
  const flag = p.featA !== p.featB ? ">" : " ";
  const top = p.ranges[0];
  console.log(
    `${flag} ${String(p.totalLines).padStart(4)} lines / ${String(p.cloneCount).padStart(2)} clones  ` +
      `${p.a}  <=>  ${p.b}`,
  );
  console.log(`        biggest block: ${p.a}:${top.aStart} <=> ${p.b}:${top.bStart} (${top.lines} lines)`);
}
