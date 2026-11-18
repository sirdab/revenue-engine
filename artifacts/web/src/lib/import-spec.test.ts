import { test } from "node:test";
import assert from "node:assert/strict";
import { autoMapHeaders, isPipedriveExport } from "./import-spec";

// Header rows as Pipedrive's spreadsheet exports write them (the column names
// the old revenue-engine importer read from real exports), in export order.
const PD_ORGS = ["ID", "Name", "Owner", "Address", "Full/combined address of Address", "Organization created"];
const PD_PEOPLE = [
  "ID",
  "Name",
  "First name",
  "Organization",
  "Organization ID",
  "Owner",
  "Email - Work",
  "Email - Home",
  "Phone - Work",
  "Phone - Mobile",
  "Job title",
  "Person created",
];
const PD_DEALS = [
  "ID",
  "Title",
  "Creator",
  "Owner",
  "Value",
  "Currency of Value",
  "Organization",
  "Organization ID",
  "Contact person",
  "Contact person ID",
  "Pipeline",
  "Stage",
  "Status",
  "Label",
  "Expected close date",
  "Deal created",
];

test("detects Pipedrive exports and leaves ordinary CSVs alone", () => {
  assert.equal(isPipedriveExport(PD_ORGS), true);
  assert.equal(isPipedriveExport(PD_PEOPLE), true);
  assert.equal(isPipedriveExport(PD_DEALS), true);
  assert.equal(isPipedriveExport(["Deal - Title", "Deal - Value"]), true);
  assert.equal(isPipedriveExport(["Name", "Email", "Phone", "Owner ID"]), false);
  assert.equal(isPipedriveExport(["Deal - Title"]), false);
});

test("Pipedrive organizations map name and address, never the owner ID", () => {
  assert.deepEqual(autoMapHeaders("organizations", PD_ORGS), {
    name: "Name",
    address: "Address",
  });
});

test("Pipedrive people map contact fields, never Pipedrive's org or owner", () => {
  assert.deepEqual(autoMapHeaders("persons", PD_PEOPLE), {
    name: "Name",
    email: "Email - Work",
    phone: "Phone - Work",
    jobTitle: "Job title",
  });
});

test("Pipedrive deals map deal fields; pipeline, stage and links come from defaults", () => {
  assert.deepEqual(autoMapHeaders("deals", PD_DEALS), {
    title: "Title",
    value: "Value",
    currency: "Currency of Value",
    personName: "Contact person",
    expectedCloseDate: "Expected close date",
    labels: "Label",
  });
});

test("entity-prefixed Pipedrive headers map to their own entity only", () => {
  const headers = [
    "Organization - Name",
    "Person - Name",
    "Person - Phone",
    "Deal - Title",
    "Deal - Value",
    "Deal - Currency",
    "Deal - Owner",
    "Deal - Pipeline",
  ];
  assert.deepEqual(autoMapHeaders("deals", headers), {
    title: "Deal - Title",
    value: "Deal - Value",
    currency: "Deal - Currency",
    personPhone: "Person - Phone",
    personName: "Person - Name",
  });
  assert.deepEqual(autoMapHeaders("organizations", ["Organization - Name", "Organization - Address"]), {
    name: "Organization - Name",
    address: "Organization - Address",
  });
});

test("a Pipedrive people export without its created-date column is still detected", () => {
  const headers = ["Name", "Organization ID", "Owner", "Email - Work", "Phone - Mobile"];
  assert.equal(isPipedriveExport(headers), true);
  assert.deepEqual(autoMapHeaders("persons", headers), {
    name: "Name",
    email: "Email - Work",
    phone: "Phone - Mobile",
  });
});

test("an ordinary CSV still maps its ID columns", () => {
  assert.deepEqual(autoMapHeaders("persons", ["Name", "Email", "Organization ID", "Owner ID"]), {
    name: "Name",
    email: "Email",
    organizationId: "Organization ID",
    ownerId: "Owner ID",
  });
});
