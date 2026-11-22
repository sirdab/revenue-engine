// Automate the busywork: deals reach the proposal stage one after another.
// Each sets the automation off; its conditions are checked; one that meets
// them is posted to Slack, and one that does not goes no further. In between,
// new deals arrive and the assignment rule hands each to the next person.
//
// As in the app: an automation whose conditions do not match simply does
// nothing, and a round-robin rule works through its team in turn.

import { type Scene, $, $$, enter, leave, pop, retrigger, settle } from "./kit";

interface Deal {
  deal: string;
  value: string;
  owner: string;
  org: string;
  time: string;
  /** Whether it is over the value the condition asks for. */
  match: boolean;
}

interface Copy {
  runs: Deal[];
  /** The Slack message's headline, with `{deal}` for the title. */
  moved: string;
  /** New deals, and the names of the people they rotate through. */
  incoming: string[];
  team: string[];
}

const fill = (root: ParentNode, selector: string, text: string) => {
  const el = $(selector, root);
  if (el) el.textContent = text;
};

/** Minutes since midnight as the time on a Slack message: "10:42". */
const clock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

function post(root: HTMLElement, copy: Copy, deal: Deal, minutes: number): void {
  fill(root, "[data-slack-text]", copy.moved.replace("{deal}", deal.deal));
  fill(root, "[data-slack-value]", deal.value);
  fill(root, "[data-slack-owner]", deal.owner);
  fill(root, "[data-slack-org]", deal.org);
  fill(root, "[data-slack-time]", clock(minutes));
}

/** When the first deal's message is sent, from the time written on it. */
function opening(copy: Copy): number {
  const [hours, minutes] = (copy.runs[0]?.time ?? "10:42").split(":").map(Number);
  return hours * 60 + minutes;
}

const pending = (root: HTMLElement) => {
  for (const check of $$("[data-check]", root)) check.classList.remove("is-yes", "is-no");
};

export const automation: Scene = {
  // Nothing has happened yet: no deal at the top, the conditions unchecked.
  // Slack shows the message before the one that is about to be sent.
  setup({ root, data }) {
    const copy = data as Copy;
    const chip = $<HTMLElement>("[data-chip]", root);
    if (chip) chip.style.visibility = "hidden";
    pending(root);
    const earlier = [...copy.runs].reverse().find((deal) => deal.match);
    if (earlier) post(root, copy, earlier, opening(copy) - 37);
  },

  async play(run, { root, data }) {
    const copy = data as Copy;
    const chip = $<HTMLElement>("[data-chip]", root);
    const wires = $$<HTMLElement>("[data-wire]", root);
    const node = (id: string) => $<HTMLElement>(`[data-node="${id}"]`, root);
    const when = node("when");
    const iff = node("if");
    const then = node("then");
    const none = $<HTMLElement>("[data-no]", root);
    const slack = $<HTMLElement>("[data-slack]", root);
    const checks = $$<HTMLElement>("[data-check]", root);
    const rota = $$<HTMLElement>("[data-rota] .g-av", root);
    const last = $<HTMLElement>("[data-last]", root);
    if (!chip || !when || !iff || !then) return;

    /** Hands over along a wire, then lights the step it leads to. */
    const along = async (wire: HTMLElement | undefined, step: HTMLElement) => {
      if (wire) retrigger(wire, "is-live");
      await run.wait(430);
      step.classList.add("is-lit");
    };

    // The messages keep their order however long this runs: each is later than the last.
    let now = opening(copy);

    const fire = async (deal: Deal) => {
      fill(chip, "[data-chip-deal]", deal.deal);
      fill(chip, "[data-chip-value]", deal.value);
      settle(chip);
      chip.style.visibility = "";
      enter(chip, { translate: "0 -0.6em" });
      await run.wait(650);
      await along(wires[0], when);
      await run.wait(560);
      when.classList.remove("is-lit");
      await along(wires[1], iff);
      await run.wait(300);
      // The stage is right for every one of them; the value is what differs.
      checks[0]?.classList.add("is-yes");
      await run.wait(340);
      checks[1]?.classList.add(deal.match ? "is-yes" : "is-no");
      await run.wait(420);
      iff.classList.remove("is-lit");
      if (deal.match) {
        await along(wires[2], then);
        await run.wait(260);
        if (slack) {
          await leave(run, slack, { translate: "0 -0.6em" }, 180);
          post(root, copy, deal, now);
          settle(slack);
          enter(slack, { translate: "0 0.9em" }, 480);
        }
        await run.wait(650);
        then.classList.remove("is-lit");
        await run.wait(1500);
      } else {
        // Not this one: the automation stops here.
        then.classList.add("is-idle");
        if (none) {
          none.hidden = false;
          pop(none, 0.7);
        }
        await run.wait(2000);
        if (none) none.hidden = true;
        then.classList.remove("is-idle");
      }
      await leave(run, chip, { translate: "0 -0.5em" });
      chip.style.visibility = "hidden";
      pending(root);
      now += 19 + ((now * 7) % 17);
    };

    /** A new deal arrives, and it is the next person's turn. */
    const assign = async (deal: string, who: number) => {
      if (!last || rota.length === 0) return;
      await leave(run, last, { translate: "0 0.3em" }, 160);
      fill(last, "[data-last-deal]", deal);
      fill(last, "[data-last-who]", copy.team[who] ?? "");
      settle(last);
      enter(last, { translate: "0 -0.4em" }, 360);
      rota.forEach((person, i) => person.classList.toggle("is-next", i === who));
    };

    await run.wait(700);
    for (let i = 0; ; i++) {
      await fire(copy.runs[i % copy.runs.length]);
      await run.wait(500);
      // The still has the first deal with the first person: go on from there.
      await assign(copy.incoming[(i + 1) % copy.incoming.length], (i + 1) % rota.length);
      await run.wait(1500);
    }
  },
};
