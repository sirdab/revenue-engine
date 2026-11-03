// i18n codemod for phase 2.
//
//   tsx i18n-codemod.ts scan  <file.tsx>            -> list candidate strings
//   tsx i18n-codemod.ts apply <job.json>            -> rewrite + add keys
//
// job.json:
// {
//   "file": "src/pages/foo.tsx",
//   "strings": [ { "en": "Save changes", "key": "foo.save", "ar": "..." } ],
//   "keys":    [ { "en": "...", "key": "...", "ar": "..." } ],   // add only
//   "edits":   [ ["old", "new"], ... ]                             // exact, after AST pass
// }
// A string entry without "ar" must reference a key that already exists.

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

// Derived from this script's own location, not hardcoded: the tooling is
// committed to the repo, so it has to work in whatever checkout it is run
// from. It previously held an absolute path to one laptop, which made every
// `scan` throw ENOENT -- and because callers redirect stderr, that reads as
// "this file has no strings left" rather than as a failure.
const REPO = path.resolve(import.meta.dirname, "../..");
const LOGIN = path.join(REPO, "artifacts/login");
const EN = path.join(LOGIN, "src/lib/i18n/en.json");
const AR = path.join(LOGIN, "src/lib/i18n/ar.json");

type Entry = { en: string; key: string; ar?: string };
type Job = { file: string; strings?: Entry[]; keys?: Entry[]; edits?: [string, string][] };

const ENTITIES: Record<string, string> = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&nbsp;": " ", "&#39;": "'", "&rarr;": "→", "&larr;": "←", "&middot;": "·", "&hellip;": "…", "&ndash;": "–", "&mdash;": "—" };
const norm = (s: string) => s.replace(/&[a-z#0-9]+;/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, " ").trim();

function parse(file: string) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { text, sf };
}

const ATTR_NAMES = new Set([
  "placeholder", "title", "label", "aria-label", "description", "alt",
  "tooltip", "emptyMessage", "heading", "subtitle", "helperText", "hint",
  "confirmLabel", "cancelLabel", "buttonLabel", "text", "name", "message",
  "prefix", "suffix", "caption", "summary", "empty",
]);

function isTypePosition(node: ts.Node): boolean {
  let n: ts.Node | undefined = node;
  while (n) {
    if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return true;
    n = n.parent;
  }
  return false;
}

function isSkippableLiteral(node: ts.StringLiteralLike): boolean {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isCaseClause(p)) return true;
  // State setters and enum-valued props carry values, not copy.
  if (ts.isCallExpression(p) && /^set[A-Z]\w*$/.test(p.expression.getText())) return true;
  if (ts.isPropertyAssignment(p) && /^(value|key|id|type|status|role|kind|mode|variant|size|side|align|href|src|field|operator|sort|dir|action|tab|view|query|queryKey)$/.test(p.name.getText())) return true;
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && /displayName$/.test(p.left.getText())) return true;
  if (ts.isCallExpression(p) && /^(cn|clsx|cva|twMerge|useQuery|useMutation|localStorage\.(get|set|remove)Item|sessionStorage\.(get|set|remove)Item|console\.(log|warn|error))$/.test(p.expression.getText())) return true;
  if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && /^(get|set|has|delete|remove|includes|startsWith|endsWith|split|join|replace|indexOf|querySelector|getAttribute|setAttribute|addEventListener|removeEventListener|getItem|setItem|removeItem)$/.test(p.expression.name.getText())) return true;
  if (ts.isCallExpression(p) && /^(cva)$/.test(p.expression.getText())) return true;
  if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && /^(cn|clsx|twMerge)$/.test(p.parent.expression.getText())) return true;
  if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || p.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) return true;
  if (ts.isJsxAttribute(p)) {
    const name = p.name.getText();
    if (name === "className" || name === "href" || name === "key" || name === "id" || name === "type" || name === "value" || name === "name" && false) return true;
    if (name === "data-testid" || name.startsWith("data-")) return true;
  }
  if (isTypePosition(node)) return true;
  return false;
}

function looksEnglish(s: string): boolean {
  const t = norm(s);
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (/^[a-z][a-zA-Z0-9_-]*$/.test(t)) return false;      // identifiers, class-ish
  if (/^[a-z0-9_.:/-]+$/.test(t)) return false;
  if (/^(sm|md|lg|xl|xs|px|rem|%|auto|none|true|false|null)$/.test(t)) return false;
  if (/^[\w-]+(\s[\w-]+)*$/.test(t) && /^[a-z]/.test(t) && !/\s/.test(t)) return false;
  if (/^[A-Za-z]+\s?\/\s?[A-Za-z]+$/.test(t) && t === t.toUpperCase()) return false; // e.g. "GET"
  if (/^[A-Z][A-Za-z0-9]*$/.test(t) && !/^[A-Z][a-z]+$/.test(t)) return false; // PascalCase identifiers
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return false; // camelCase
  // Tailwind class lists: no capitals, and at least one utility-shaped token.
  if (!/[A-Z]/.test(t) && /(^|\s)[a-z0-9]*[-:\[\]\/&>~*!][^\s]*(\s|$)/.test(t) && !/[.,!?]$/.test(t)) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (/^[#\/][^\s]*$/.test(t)) return false;
  return true;
}

function scan(file: string) {
  const { text, sf } = parse(file);
  const out: { line: number; kind: string; text: string }[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const t = norm(node.text);
      if (t && looksEnglish(t)) out.push({ line: lineOf(node.getStart()), kind: "jsxtext", text: t });
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isSkippableLiteral(node)) {
        const t = node.text;
        const p = node.parent;
        let kind = "literal";
        if (ts.isJsxAttribute(p)) kind = `attr:${p.name.getText()}`;
        else if (ts.isPropertyAssignment(p)) kind = `prop:${p.name.getText()}`;
        else if (ts.isJsxExpression(p)) kind = "jsxexpr";
        if (kind.startsWith("attr:") && !ATTR_NAMES.has(kind.slice(5))) {
          if (!looksEnglish(t) || !/\s|^[A-Z]/.test(t)) return;
        }
        if (looksEnglish(t) && (/\s/.test(t) || /^[A-Z]/.test(t) || kind.startsWith("attr:"))) out.push({ line: lineOf(node.getStart()), kind, text: t });
      }
    } else if (ts.isTemplateExpression(node)) {
      const raw = text.slice(node.getStart(), node.getEnd());
      if (/[A-Za-z]{3,}/.test(node.head.text + node.templateSpans.map((s) => s.literal.text).join(" ")) && /[A-Z]|\s[a-z]+\s/.test(raw)) out.push({ line: lineOf(node.getStart()), kind: "template", text: raw.replace(/\s+/g, " ") });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const o of out) console.log(`${String(o.line).padStart(5)}  ${o.kind.padEnd(18)} ${o.text}`);
  console.log(`-- ${out.length} candidates`);
}

function loadDict(p: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function saveDict(p: string, d: Record<string, string>) {
  const sorted = Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]]));
  fs.writeFileSync(p, JSON.stringify(sorted, null, 2) + "\n");
}

function addKeys(entries: Entry[], en: Record<string, string>, ar: Record<string, string>): string[] {
  const problems: string[] = [];
  const byEnText = new Map<string, string>();
  for (const [k, v] of Object.entries(en)) if (!k.includes("#")) byEnText.set(v, k);
  for (const e of entries) {
    if (e.ar === undefined) {
      if (!(e.key in en)) problems.push(`reuse of unknown key ${e.key} (${JSON.stringify(e.en)})`);
      else if (en[e.key] !== e.en && !e.key.includes("#")) problems.push(`reuse ${e.key}: en.json says ${JSON.stringify(en[e.key])}, job says ${JSON.stringify(e.en)}`);
      continue;
    }
    if (e.key in en) {
      if (en[e.key] !== e.en) problems.push(`key ${e.key} already exists with different text ${JSON.stringify(en[e.key])}`);
      if (ar[e.key] !== e.ar) ar[e.key] = e.ar;
      continue;
    }
    const existing = byEnText.get(e.en);
    if (existing && existing.startsWith("common.")) problems.push(`note: ${JSON.stringify(e.en)} already exists as ${existing}; consider reusing`);
    en[e.key] = e.en;
    ar[e.key] = e.ar;
    byEnText.set(e.en, e.key);
  }
  return problems;
}

function componentAncestor(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let n: ts.Node | undefined = node;
  while (n) {
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && n.body && ts.isBlock(n.body)) {
      let name = "";
      if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) name = n.name?.getText() ?? "";
      if (!name && ts.isVariableDeclaration(n.parent)) name = n.parent.name.getText();
      if (!name && ts.isPropertyAssignment(n.parent)) name = n.parent.name.getText();
      if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) return n;
      // A forwardRef / memo callback: the variable is the component.
      if (ts.isCallExpression(n.parent) && ts.isVariableDeclaration(n.parent.parent) && /^[A-Z]/.test(n.parent.parent.name.getText())) return n;
    }
    n = n.parent;
  }
  return null;
}

function apply(jobPath: string) {
  const job: Job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  const file = path.isAbsolute(job.file) ? job.file : path.join(LOGIN, job.file);
  const { text, sf } = parse(file);
  const shadow = text.match(/\b(?:const|let|var)\s+t\b|\(\s*t\s*\)\s*=>|\(\s*t\s*,|,\s*t\s*\)\s*=>|\bt\s*:\s*[A-Z][A-Za-z]*[,)]/);
  if (shadow) console.log(`WARNING local binding named t in this file: ${JSON.stringify(shadow[0])} — rename it before relying on t()`);
  const en = loadDict(EN);
  const ar = loadDict(AR);
  const problems = addKeys([...(job.strings ?? []), ...(job.keys ?? [])], en, ar);

  const map = new Map<string, string>();
  for (const s of job.strings ?? []) {
    if (map.has(s.en) && map.get(s.en) !== s.key) problems.push(`duplicate en text ${JSON.stringify(s.en)} mapped to two keys`);
    map.set(s.en, s.key);
  }
  const used = new Set<string>();
  const reps: { start: number; end: number; text: string; node: ts.Node }[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const t = norm(node.text);
      const key = map.get(t);
      if (key) {
        const raw = node.getFullText();
        const lead = raw.length - raw.trimStart().length;
        const trail = raw.length - raw.trimEnd().length;
        const start = node.getFullStart() + lead;
        const end = node.getEnd() - trail;
        reps.push({ start, end, text: `{t("${key}")}`, node });
        used.add(t);
      }
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isSkippableLiteral(node)) {
      const key = map.get(node.text);
      if (key && (ts.isBindingElement(node.parent) || ts.isParameter(node.parent))) {
        problems.push(`DEFAULT PARAM not rewritten (needs a prop-rename edit): ${JSON.stringify(node.text)} at line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      } else if (key) {
        const p = node.parent;
        const call = `t("${key}")`;
        reps.push({ start: node.getStart(), end: node.getEnd(), text: ts.isJsxAttribute(p) ? `{${call}}` : call, node });
        used.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const s of map.keys()) if (!used.has(s)) problems.push(`not found in file: ${JSON.stringify(s)}`);

  // Hook insertion points, one per component.
  const hookTargets = new Map<ts.FunctionLikeDeclaration, ts.Node>();
  const orphans: string[] = [];
  for (const r of reps) {
    const comp = componentAncestor(r.node);
    if (!comp) {
      orphans.push(`t() outside a component at line ${sf.getLineAndCharacterOfPosition(r.start).line + 1}: ${r.text}`);
      continue;
    }
    if (!hookTargets.has(comp)) hookTargets.set(comp, r.node);
  }

  let out = text;
  const edits: { start: number; end: number; text: string }[] = reps.map(({ start, end, text }) => ({ start, end, text }));
  for (const comp of hookTargets.keys()) {
    const body = comp.body as ts.Block;
    const bodyText = body.getText();
    if (/useI18n\(/.test(bodyText)) {
      if (!/\bt\b[^(]*\}\s*=\s*useI18n\(/.test(bodyText) && !/\{\s*t\s*[,}]/.test(bodyText.slice(bodyText.indexOf("useI18n") - 80, bodyText.indexOf("useI18n")))) {
        problems.push(`component at line ${sf.getLineAndCharacterOfPosition(comp.getStart()).line + 1} calls useI18n() without destructuring t — check`);
      }
      continue;
    }
    const first = body.statements[0];
    const insertAt = first ? first.getStart() : body.getStart() + 1;
    let indent = "  ";
    if (first) {
      const lineStart = text.lastIndexOf("\n", first.getStart()) + 1;
      indent = text.slice(lineStart, first.getStart()).replace(/\S.*$/, "");
    }
    const ins = first ? `const { t } = useI18n();\n${indent}` : `\n${indent}const { t } = useI18n();\n`;
    edits.push({ start: insertAt, end: insertAt, text: ins });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  if (reps.length && !/from "@\/lib\/i18n\/i18n"/.test(out)) {
    const imports = [...out.matchAll(/^import[\s\S]*?from\s+"[^"]+";?[ \t]*$/gm)];
    const last = imports[imports.length - 1];
    const semi = last ? /;$/.test(last[0].trimEnd()) : true;
    const at = last ? last.index! + last[0].length : 0;
    out = out.slice(0, at) + (last ? "\n" : "") + `import { useI18n } from "@/lib/i18n/i18n"${semi ? ";" : ""}` + (last ? "" : "\n") + out.slice(at);
  } else if (reps.length && !/useI18n/.test(out.match(/import[^;]*i18n\/i18n"/)?.[0] ?? "")) {
    out = out.replace(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/i18n\/i18n";/, (m, names) => `import {${names.trimEnd()}, useI18n } from "@/lib/i18n/i18n";`);
  }

  for (const [oldS, newS] of job.edits ?? []) {
    const idx = out.indexOf(oldS);
    if (idx === -1) { problems.push(`edit not found: ${JSON.stringify(oldS.slice(0, 80))}`); continue; }
    if (out.indexOf(oldS, idx + 1) !== -1) { problems.push(`edit ambiguous: ${JSON.stringify(oldS.slice(0, 80))}`); continue; }
    out = out.slice(0, idx) + newS + out.slice(idx + oldS.length);
  }

  fs.writeFileSync(file, out);
  // English selects only one/other; the plural() helper feeds every category
  // so Arabic gets all six, and the extras are dropped here.
  for (const k of Object.keys(en)) if (k.includes("#") && !/#(one|other)$/.test(k)) delete en[k];
  saveDict(EN, en);
  saveDict(AR, ar);
  console.log(`applied ${reps.length} replacements, ${hookTargets.size} components, ${(job.edits ?? []).length} edits`);
  for (const o of orphans) console.log("ORPHAN " + o);
  for (const p of problems) console.log("PROBLEM " + p);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "scan") scan(path.isAbsolute(arg) ? arg : path.join(LOGIN, arg));
else if (mode === "apply") apply(arg);
else { console.error("usage: scan <file> | apply <job.json>"); process.exit(1); }
