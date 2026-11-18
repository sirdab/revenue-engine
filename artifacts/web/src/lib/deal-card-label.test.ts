import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanDealTitle, dealCardLabel } from "./deal-card-label";

// Every input below has the shape of a real-world deal title.
describe("cleanDealTitle", () => {
  it("drops the Pipedrive ' Deal' suffix", () => {
    assert.equal(cleanDealTitle("Horizon Deal"), "Horizon");
    assert.equal(cleanDealTitle("شركة النجمة الذهبية Deal"), "شركة النجمة الذهبية");
    assert.equal(cleanDealTitle("Jordan Lee Carter deal"), "Jordan Lee Carter");
  });

  it("drops phone numbers and the separator left behind", () => {
    assert.equal(cleanDealTitle("الأفق - +447700900123"), "الأفق");
    assert.equal(cleanDealTitle("NOVA TECH | نوفا تك - +447700900456"), "NOVA TECH | نوفا تك");
    assert.equal(cleanDealTitle("447700900789 — Transportation"), "Transportation");
    assert.equal(cleanDealTitle("447700900234 Brightline"), "Brightline");
  });

  it("drops a form's 'Company Name:' label", () => {
    assert.equal(cleanDealTitle("Company Name: Example Business Services Deal"), "Example Business Services");
  });

  it("keeps short numbers that are part of the name", () => {
    assert.equal(cleanDealTitle("ACME400 — New Customer Deal"), "ACME400 — New Customer");
    assert.equal(cleanDealTitle("Springfield 2000 seat expansion"), "Springfield 2000 seat expansion");
  });

  it("keeps 'Deal' when it is not a trailing word", () => {
    assert.equal(cleanDealTitle("Dealer network"), "Dealer network");
  });

  it("empties a title that was only a phone number", () => {
    assert.equal(cleanDealTitle("- +447700900321"), "");
  });
});

describe("dealCardLabel", () => {
  it("hides the org line when the name already says it", () => {
    assert.deepEqual(
      dealCardLabel({ title: "Summit Distribution Deal", organizationName: "Summit Distribution", personName: "Alex" }),
      { primary: "Summit Distribution", secondary: "Alex" },
    );
  });

  it("shows the org when it adds something", () => {
    assert.deepEqual(
      dealCardLabel({ title: "Northwind — Second office", organizationName: "Northwind" }),
      { primary: "Northwind — Second office", secondary: "Northwind" },
    );
  });

  it("names a phone-only deal after its org, then its person", () => {
    assert.deepEqual(
      dealCardLabel({ title: "- +447700900321", organizationName: "Brightline", personName: "Sara" }),
      { primary: "Brightline", secondary: "Sara" },
    );
    assert.deepEqual(
      dealCardLabel({ title: "+447700900321", personName: "Sara" }),
      { primary: "Sara", secondary: null },
    );
  });

  it("falls back to the raw title when there is nothing better", () => {
    assert.deepEqual(dealCardLabel({ title: "Deal" }), { primary: "Deal", secondary: null });
  });
});
