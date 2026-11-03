// XLSX export for any DataTable: a real workbook with typed number and date
// cells people can sum and pivot, not a CSV that arrives as text.
//
// Split in two on purpose. `buildWorkbook` is pure — it takes rows and columns
// and returns a workbook, so it is testable under `node --test` with no DOM and
// no browser. `downloadXlsx` is the thin shim that hands the bytes to the
// browser, and follows the download pattern already used by the import
// template (`import-spec.ts`).
//
// exceljs is NOT imported at the top of this module. `downloadXlsx` reaches it
// through `await import("exceljs")` so roughly a megabyte of spreadsheet
// machinery stays out of the main bundle and loads only when somebody actually
// clicks Export.

import type ExcelJS from "exceljs";

/** What a cell may hold. Numbers and dates stay typed so Excel can do maths on
 *  them; everything else lands as text. */
export type SheetCellValue = string | number | Date | boolean | null;

/** One exported column: a plain-text header and the row's value as data. The
 *  table's own `cell` renderers return React nodes, which an export cannot
 *  use, so each column states its value separately. */
export interface SheetColumn<T> {
  header: string;
  value: (row: T) => SheetCellValue;
}

export interface SheetSpec<T> {
  rows: T[];
  columns: SheetColumn<T>[];
  /** Worksheet tab name. Sanitized — Excel is strict about these. */
  sheetName?: string;
}

/** Money and other decimals: 1,234.56. */
const NUMBER_FORMAT = "#,##0.00";
/** Dates read the way the business writes them. */
const DATE_FORMAT = "dd/mm/yyyy";

const ILLEGAL_FILENAME_CHARS = new Set([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 50;

/** Excel's own rules for a worksheet name: at most 31 characters, and none of
 *  `[ ] : * ? / \`. A name that breaks either makes the file unopenable, and
 *  these names come from user data (e.g. a person's name), so this is
 *  correctness rather than tidiness. A blank result falls back to "Sheet1",
 *  which is what Excel would have called it anyway. */
export function sanitizeSheetName(name: string): string {
  const cleaned = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Excel also rejects a name wrapped in single quotes.
    .replace(/^'+|'+$/g, "")
    .slice(0, 31)
    .trim();
  return cleaned || "Sheet1";
}

/** Keep a filename to something every OS will accept, and guarantee the
 *  extension. Mirrors what the server does for uploads in
 *  `lib/file-validation.ts`, but the browser needs its own copy.
 *
 *  Spaces, hyphens and dashes are deliberately kept: they are legal on every
 *  platform, and these names read as sentences ("Deals — Sara —
 *  2026-09-30.xlsx"). */
export function sanitizeFileName(name: string): string {
  const stripped = Array.from(name)
    .map((ch) => {
      if (ILLEGAL_FILENAME_CHARS.has(ch)) return " ";
      // Control characters have no business in a filename either.
      return (ch.codePointAt(0) ?? 0) < 0x20 ? " " : ch;
    })
    .join("");
  const cleaned = stripped
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot would make a hidden file on unix.
    .replace(/^\.+/, "")
    .slice(0, 180)
    .trim();
  const base = cleaned || "export";
  return base.toLowerCase().endsWith(".xlsx") ? base : `${base}.xlsx`;
}

/** Roughly how wide a column needs to be to show its contents, so the file
 *  opens readable instead of full of `####`. Clamped at both ends: a narrow
 *  column should still show its header, and one long note should not push the
 *  rest of the sheet off the screen. */
function columnWidth(header: string, values: SheetCellValue[]): number {
  let widest = header.length;
  for (const v of values) {
    if (v == null) continue;
    const len = v instanceof Date ? DATE_FORMAT.length : String(v).length;
    if (len > widest) widest = len;
  }
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, widest + 2));
}

/**
 * Build the workbook. Pure: no DOM, no network, no import side effects beyond
 * exceljs itself.
 *
 * Columns are written in the order given — the caller passes them in the order
 * the user is actually looking at.
 */
export async function buildWorkbook<T>({
  rows,
  columns,
  sheetName,
}: SheetSpec<T>): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import("exceljs");
  const workbook = new Excel.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sanitizeSheetName(sheetName ?? "Sheet1"), {
    // The header stays put while scrolling a few hundred rows.
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.addRow(columns.map((c) => c.header));

  const cellsByColumn: SheetCellValue[][] = columns.map(() => []);
  for (const row of rows) {
    const values = columns.map((c, i) => {
      const v = c.value(row);
      cellsByColumn[i].push(v);
      // exceljs writes `null` as an empty cell, which is what an absent value
      // should look like; `undefined` from a stray getter would too, but be
      // explicit.
      return v ?? null;
    });
    sheet.addRow(values);
  }

  // Header: bold on a light fill, so it reads as a header rather than as the
  // first row.
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });

  // Per-column width and number format. Formats are set on the column so they
  // apply to every data cell without walking the rows again.
  columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = columnWidth(c.header, cellsByColumn[i]);
    const sample = cellsByColumn[i].find((v) => v != null);
    if (typeof sample === "number") column.numFmt = NUMBER_FORMAT;
    else if (sample instanceof Date) column.numFmt = DATE_FORMAT;
  });

  // Let them sort and filter in Excel too. Only with data: an autofilter over
  // a header row alone makes some viewers complain.
  if (rows.length > 0 && columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    };
  }

  return workbook;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Build the workbook and hand it to the browser as a download. Same
 * object-URL-and-anchor dance as the CSV template download in `import-spec.ts`
 * — the only pattern in this codebase for giving the user a file the client
 * generated.
 */
export async function downloadXlsx<T>(
  spec: SheetSpec<T> & { fileName: string },
): Promise<void> {
  const workbook = await buildWorkbook(spec);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_MIME }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFileName(spec.fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
