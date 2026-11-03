import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { sheetVariants, type SheetSide } from "./sheet-variants"

// The runner has no DOM, so the contract under test is the class list: a side
// sheet must be pinned AND animated in logical terms, so the browser's `dir`
// resolves both together. A physical `left-0` / `slide-in-from-right` in that
// list is exactly the bug this guards against (pinned on one edge, sliding
// from the other, so the drawer crosses the whole screen in Arabic).

const PHYSICAL_X = /(?:^|[\s:])(?:left-0|right-0|border-l|border-r|slide-(?:in-from|out-to)-(?:left|right))(?=\s|$)/

function classesOf(side: SheetSide): string[] {
  return sheetVariants({ side }).split(/\s+/)
}

describe("Sheet side variants", () => {
  it("pins the end sheet on the end edge and slides it from the end", () => {
    const classes = classesOf("end")
    assert.ok(classes.includes("end-0"))
    assert.ok(classes.includes("data-[state=open]:slide-in-from-end"))
    assert.ok(classes.includes("data-[state=closed]:slide-out-to-end"))
    assert.ok(classes.includes("border-s"))
  })

  it("pins the start sheet on the start edge and slides it from the start", () => {
    const classes = classesOf("start")
    assert.ok(classes.includes("start-0"))
    assert.ok(classes.includes("data-[state=open]:slide-in-from-start"))
    assert.ok(classes.includes("data-[state=closed]:slide-out-to-start"))
    assert.ok(classes.includes("border-e"))
  })

  it("never mixes a physical horizontal class into a side sheet", () => {
    for (const side of ["start", "end", "left", "right"] as const) {
      assert.doesNotMatch(
        sheetVariants({ side }),
        PHYSICAL_X,
        `side="${side}" carries a physical class`
      )
    }
  })

  it("keeps left and right as aliases of start and end", () => {
    assert.equal(sheetVariants({ side: "left" }), sheetVariants({ side: "start" }))
    assert.equal(sheetVariants({ side: "right" }), sheetVariants({ side: "end" }))
  })

  it("defaults to the end edge", () => {
    assert.equal(sheetVariants({}), sheetVariants({ side: "end" }))
  })
})
