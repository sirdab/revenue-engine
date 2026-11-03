import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanDealTitle, dealCardLabel } from "./deal-card-label";

// Every input below has the shape of a typical machine-made deal title.
describe("cleanDealTitle", () => {
  it("drops the Pipedrive ' Deal' suffix", () => {
    assert.equal(cleanDealTitle("Northwind Deal"), "Northwind");
    assert.equal(cleanDealTitle("شركة النخبة للتجارة Deal"), "شركة النخبة للتجارة");
    assert.equal(cleanDealTitle("Omar Khalid Hassan deal"), "Omar Khalid Hassan");
  });

  it("drops phone numbers and the separator left behind", () => {
    assert.equal(cleanDealTitle("الريادة - +966500000001"), "الريادة");
    assert.equal(cleanDealTitle("Acme Labs | أكمي لابز - +966500000002"), "Acme Labs | أكمي لابز");
    assert.equal(cleanDealTitle("966500000003 — Logistics"), "Logistics");
    assert.equal(cleanDealTitle("966500000004 Contoso"), "Contoso");
  });

  it("drops a form's 'Company Name:' label", () => {
    assert.equal(cleanDealTitle("Company Name: Modern Business Services Deal"), "Modern Business Services");
  });

  it("keeps short numbers that are part of the name", () => {
    assert.equal(cleanDealTitle("ACME400 — New Customer Deal"), "ACME400 — New Customer");
    assert.equal(cleanDealTitle("Riyadh 2000 sqm expansion"), "Riyadh 2000 sqm expansion");
  });

  it("keeps 'Deal' when it is not a trailing word", () => {
    assert.equal(cleanDealTitle("Dealer network"), "Dealer network");
  });

  it("empties a title that was only a phone number", () => {
    assert.equal(cleanDealTitle("- +966500000005"), "");
  });
});

describe("dealCardLabel", () => {
  it("hides the org line when the name already says it", () => {
    assert.deepEqual(
      dealCardLabel({ title: "Globex Distribution Deal", organizationName: "Globex Distribution", personName: "Ali" }),
      { primary: "Globex Distribution", secondary: "Ali" },
    );
  });

  it("shows the org when it adds something", () => {
    assert.deepEqual(
      dealCardLabel({ title: "Initech — Second site", organizationName: "Initech" }),
      { primary: "Initech — Second site", secondary: "Initech" },
    );
  });

  it("names a phone-only deal after its org, then its person", () => {
    assert.deepEqual(
      dealCardLabel({ title: "- +966500000005", organizationName: "Umbrella", personName: "Sara" }),
      { primary: "Umbrella", secondary: "Sara" },
    );
    assert.deepEqual(
      dealCardLabel({ title: "+966500000005", personName: "Sara" }),
      { primary: "Sara", secondary: null },
    );
  });

  it("falls back to the raw title when there is nothing better", () => {
    assert.deepEqual(dealCardLabel({ title: "Deal" }), { primary: "Deal", secondary: null });
  });
});
