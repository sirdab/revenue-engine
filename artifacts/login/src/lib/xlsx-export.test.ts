import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook, sanitizeFileName, sanitizeSheetName } from "./xlsx-export";

// These read the workbook back out of exceljs rather than trusting the writes,
// because the thing that matters about this export is that Excel receives a
// NUMBER where a number was meant — a sheet of text that merely looks right is
// the failure people would actually hit, the moment they try to sum a column.

interface Row {
  name: string;
  owed: number;
  due: Date | null;
  locked: boolean;
}

const ROWS: Row[] = [
  { name: "Acme", owed: 1234.56, due: new Date(Date.UTC(2026, 0, 15)), locked: false },
  { name: "Beta", owed: 0, due: null, locked: true },
];

const COLUMNS = [
  { header: "Customer", value: (r: Row) => r.name },
  { header: "Owed", value: (r: Row) => r.owed },
  { header: "Oldest", value: (r: Row) => r.due },
  { header: "Suspended", value: (r: Row) => (r.locked ? "Yes" : null) },
];

test("buildWorkbook writes the header then one row per record", async () => {
  const wb = await buildWorkbook({ rows: ROWS, columns: COLUMNS, sheetName: "Sara" });
  const sheet = wb.getWorksheet("Sara");
  assert.ok(sheet, "the sheet is named after the person");
  assert.equal(sheet.rowCount, 3, "header + 2 rows");
  assert.deepEqual(
    (sheet.getRow(1).values as unknown[]).slice(1),
    ["Customer", "Owed", "Oldest", "Suspended"],
  );
});

test("buildWorkbook keeps numbers and dates typed, not stringified", async () => {
  const wb = await buildWorkbook({ rows: ROWS, columns: COLUMNS });
  const sheet = wb.worksheets[0];
  const owed = sheet.getRow(2).getCell(2).value;
  assert.equal(typeof owed, "number", "owed must be a number Excel can sum");
  assert.equal(owed, 1234.56);
  const due = sheet.getRow(2).getCell(3).value;
  assert.ok(due instanceof Date, "a date must be a real date cell");
  assert.equal((due as Date).toISOString().slice(0, 10), "2026-01-15");
});

test("buildWorkbook formats number and date columns", async () => {
  const wb = await buildWorkbook({ rows: ROWS, columns: COLUMNS });
  const sheet = wb.worksheets[0];
  assert.equal(sheet.getColumn(2).numFmt, "#,##0.00");
  assert.equal(sheet.getColumn(3).numFmt, "dd/mm/yyyy");
  // Text columns get no imposed format.
  assert.equal(sheet.getColumn(1).numFmt, undefined);
});

test("buildWorkbook writes an absent value as a blank cell", async () => {
  const wb = await buildWorkbook({ rows: ROWS, columns: COLUMNS });
  const sheet = wb.worksheets[0];
  // Row 3 is Beta: no oldest date, so the cell must be empty rather than the
  // string "null".
  assert.equal(sheet.getRow(3).getCell(3).value, null);
});

test("buildWorkbook writes columns in the order given", async () => {
  // The caller passes the user's current column order; the builder must not
  // reorder it back to some canonical order of its own.
  const reversed = [...COLUMNS].reverse();
  const wb = await buildWorkbook({ rows: ROWS, columns: reversed });
  assert.deepEqual(
    (wb.worksheets[0].getRow(1).values as unknown[]).slice(1),
    ["Suspended", "Oldest", "Owed", "Customer"],
  );
});

test("buildWorkbook freezes the header and autofilters the data", async () => {
  const wb = await buildWorkbook({ rows: ROWS, columns: COLUMNS });
  const sheet = wb.worksheets[0];
  assert.equal(sheet.views[0]?.state, "frozen");
  assert.equal((sheet.views[0] as { ySplit?: number }).ySplit, 1);
  assert.deepEqual(sheet.autoFilter, {
    from: { row: 1, column: 1 },
    to: { row: 3, column: 4 },
  });
  assert.equal(sheet.getRow(1).font?.bold, true);
});

test("buildWorkbook handles an empty list without an autofilter", async () => {
  // An empty page should still produce a readable, openable file.
  const wb = await buildWorkbook({ rows: [], columns: COLUMNS, sheetName: "Empty" });
  const sheet = wb.getWorksheet("Empty");
  assert.ok(sheet);
  assert.equal(sheet.rowCount, 1, "just the header");
  // exceljs leaves this null rather than undefined when unset.
  assert.ok(!sheet.autoFilter, "no autofilter over a header row alone");
});

test("sanitizeSheetName obeys Excel's rules", async () => {
  // Excel rejects these outright; a person's name reaches this unescaped.
  assert.equal(sanitizeSheetName("Legal/Unassigned"), "Legal Unassigned");
  assert.equal(sanitizeSheetName("a[b]c:d*e?f"), "a b c d e f");
  // 31-character cap.
  const long = sanitizeSheetName("x".repeat(60));
  assert.equal(long.length, 31);
  // Never empty — Excel needs some name.
  assert.equal(sanitizeSheetName("   "), "Sheet1");
  assert.equal(sanitizeSheetName("///"), "Sheet1");
  // Arabic names pass through: the business runs in both languages.
  assert.equal(sanitizeSheetName("المحاسبة"), "المحاسبة");
});

test("sanitizeSheetName survives a real build", async () => {
  // The guard is worthless if addWorksheet still rejects the result.
  const wb = await buildWorkbook({
    rows: ROWS,
    columns: COLUMNS,
    sheetName: "Team/Region: *everything*".repeat(3),
  });
  assert.equal(wb.worksheets.length, 1);
  assert.ok(wb.worksheets[0].name.length <= 31);
});

test("sanitizeFileName produces a safe name ending in .xlsx", async () => {
  // Dashes and spaces survive — they are legal and the name reads as a sentence.
  assert.equal(
    sanitizeFileName("Collections — Sara — 2026-09-30"),
    "Collections — Sara — 2026-09-30.xlsx",
  );
  assert.equal(sanitizeFileName('bad/name\\with:"chars'), "bad name with chars.xlsx");
  assert.equal(sanitizeFileName("already.xlsx"), "already.xlsx");
  assert.equal(sanitizeFileName("  "), "export.xlsx");
  // No leading dots, which would make a hidden file on unix.
  assert.ok(!sanitizeFileName("...sheet").startsWith("."));
});

test("the workbook serializes to real xlsx bytes", async () => {
  // End to end through exceljs's writer: a workbook that builds but cannot be
  // written is no use, and the download shim does exactly this call.
  const wb = await buildWorkbook({ rows: ROWS, columns: COLUMNS, sheetName: "Sara" });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  assert.ok(buffer.length > 0);
  // xlsx is a zip: "PK".
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
});
