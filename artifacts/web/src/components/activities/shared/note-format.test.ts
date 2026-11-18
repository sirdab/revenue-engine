import { test } from "node:test";
import assert from "node:assert/strict";
import { appendResponse, canMarkNoReply, plainToHtml } from "./note-format.ts";

test("the response joins the existing note as HTML blocks", () => {
  assert.equal(appendResponse(null, "<p>Yes</p>"), "<p>Yes</p>");
  assert.equal(appendResponse("   ", "<p>Yes</p>"), "<p>Yes</p>");
  assert.equal(
    appendResponse("<p>Ask about the renewal</p>", "<p>Confirmed</p>"),
    "<p>Ask about the renewal</p><p>Confirmed</p>",
  );
});

test("a legacy plain note is escaped, never turned into markup", () => {
  assert.equal(
    appendResponse("price < 5 & <script>x</script>\nline two", "<p>ok</p>"),
    "<p>price &lt; 5 &amp; &lt;script&gt;x&lt;/script&gt;<br>line two</p><p>ok</p>",
  );
  assert.equal(plainToHtml("a\r\nb"), "<p>a<br>b</p>");
});

test("No reply is offered only where the server accepts it", () => {
  const C = ["call", "meeting", "email", "whatsapp"];
  const open = { done: false, type: "call" };
  assert.equal(canMarkNoReply(open, C), true);
  assert.equal(canMarkNoReply({ ...open, done: true }, C), false);
  assert.equal(canMarkNoReply({ ...open, draft: true }, C), false);
  assert.equal(canMarkNoReply({ ...open, type: "task" }, C), false);
});
