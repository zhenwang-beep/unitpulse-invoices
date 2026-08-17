import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_QUOTE_DEFAULTS,
  QUOTE_NUMBER_PENDING,
  QUOTE_STATUSES,
  TRANSITION_WARNINGS,
  addDays,
  createEmptyQuote,
  displayMonthly,
  quoteSubtotal,
  toISODate,
  type QuoteDefaults,
  type QuoteStatus,
} from "./quote";

describe("QUOTE_STATUSES", () => {
  it("is exactly the four storable statuses", () => {
    expect(QUOTE_STATUSES).toEqual(["draft", "sent", "accepted", "declined"]);
  });

  it("does not offer 'expired' as something a user can save", () => {
    // Expiry is a function of validUntil, computed server-side. Persisting it
    // would mean extending the date could not clear it.
    expect(QUOTE_STATUSES).not.toContain("expired");
  });

  it("has no duplicates", () => {
    expect(new Set(QUOTE_STATUSES).size).toBe(QUOTE_STATUSES.length);
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("treats accepted and declined as terminal", () => {
    expect(ALLOWED_TRANSITIONS.accepted).toEqual([]);
    expect(ALLOWED_TRANSITIONS.declined).toEqual([]);
  });

  it("lets a draft be sent, or settled directly if it was settled off-app", () => {
    expect(ALLOWED_TRANSITIONS.draft).toEqual(["sent", "accepted", "declined"]);
  });

  it("lets a sent quote be pulled back to draft", () => {
    expect(ALLOWED_TRANSITIONS.sent).toContain("draft");
  });

  it("covers every storable status and nothing else", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...QUOTE_STATUSES].sort());
    expect(Object.keys(ALLOWED_TRANSITIONS)).not.toContain("expired");
  });

  it("only ever proposes a status the system can store", () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) {
        expect(QUOTE_STATUSES).toContain(to);
        expect(to, `${from} should not transition to itself`).not.toBe(from);
      }
    }
  });

  it("cannot be walked back out of a terminal status", () => {
    // The one property that makes accepted/declined meaningful: no path exists
    // from either back into the live part of the graph.
    const reachableFromTerminal = (["accepted", "declined"] as QuoteStatus[]).flatMap(
      (s) => ALLOWED_TRANSITIONS[s],
    );
    expect(reachableFromTerminal).toEqual([]);
  });
});

describe("TRANSITION_WARNINGS", () => {
  it("only warns about transitions that are actually offered", () => {
    for (const key of Object.keys(TRANSITION_WARNINGS)) {
      const [from, to] = key.split(">") as [QuoteStatus, QuoteStatus];
      expect(QUOTE_STATUSES, `unknown status in "${key}"`).toContain(from);
      expect(
        ALLOWED_TRANSITIONS[from],
        `"${key}" warns about a move the UI never offers`,
      ).toContain(to);
    }
  });

  it("warns on the two moves that surprise the user", () => {
    expect(TRANSITION_WARNINGS["draft>accepted"]).toBeTruthy();
    expect(TRANSITION_WARNINGS["sent>draft"]).toBeTruthy();
  });

  it("stays silent on the ordinary send", () => {
    expect(TRANSITION_WARNINGS["draft>sent"]).toBeUndefined();
  });
});

describe("createEmptyQuote", () => {
  it("starts as an unsaved draft with no number of its own", () => {
    const q = createEmptyQuote();
    expect(q.status).toBe("draft");
    expect(q.id).toBe("");
    // The database allocates the number on first save; a browser-side guess
    // collides against UNIQUE(user_id, quote_number).
    expect(q.quoteNumber).toBe(QUOTE_NUMBER_PENDING);
    expect(q.currency).toBe("USD");
    expect(q.setupFee).toBe(0);
  });

  it("carries no server-computed totals, so display falls back to local maths", () => {
    const q = createEmptyQuote();
    expect(q.subtotal).toBeUndefined();
    expect(q.totalMonthly).toBeUndefined();
    expect(q.initialAmountDue).toBeUndefined();
    expect(q.effectiveStatus).toBeUndefined();
    expect(displayMonthly(q)).toBe(quoteSubtotal(q.lineItems));
  });

  it("dates the quote today and expires it after the configured window", () => {
    const q = createEmptyQuote();
    expect(q.quoteDate).toBe(toISODate(new Date()));
    expect(q.validUntil).toBe(addDays(q.quoteDate, DEFAULT_QUOTE_DEFAULTS.validityDays));
  });

  it("honours a custom validity window", () => {
    const defaults: QuoteDefaults = { ...DEFAULT_QUOTE_DEFAULTS, validityDays: 7 };
    const q = createEmptyQuote(defaults);
    expect(q.validUntil).toBe(addDays(q.quoteDate, 7));
  });

  // -------------------------------------------------------------------------
  // The deep-copy contract. DEFAULT_QUOTE_DEFAULTS is a module-level singleton;
  // if a new quote aliases it, editing one quote's scope silently rewrites the
  // boilerplate every later quote inherits — including quotes already open in
  // another tab of the same session.
  // -------------------------------------------------------------------------
  describe("does not alias the defaults", () => {
    it("adding a scope group leaves the defaults alone", () => {
      const before = DEFAULT_QUOTE_DEFAULTS.scopeGroups.length;
      const q = createEmptyQuote();
      q.scopeGroups.push({ id: "x", title: "Extra", category: "Ad hoc", bullets: [] });
      expect(DEFAULT_QUOTE_DEFAULTS.scopeGroups.length).toBe(before);
      expect(q.scopeGroups.length).toBe(before + 1);
    });

    it("renaming a scope group leaves the defaults alone", () => {
      const before = DEFAULT_QUOTE_DEFAULTS.scopeGroups[0].title;
      const q = createEmptyQuote();
      q.scopeGroups[0].title = "Rewritten by the editor";
      expect(DEFAULT_QUOTE_DEFAULTS.scopeGroups[0].title).toBe(before);
      expect(q.scopeGroups[0].title).toBe("Rewritten by the editor");
    });

    it("editing a nested bullet leaves the defaults alone", () => {
      // The one a shallow `{...g}` spread would miss: bullets is an array
      // inside each group, so copying the group object is not enough.
      const before = [...DEFAULT_QUOTE_DEFAULTS.scopeGroups[0].bullets];
      const q = createEmptyQuote();
      q.scopeGroups[0].bullets.push("A bullet added while editing one quote");
      q.scopeGroups[0].bullets[0] = "Reworded";
      expect(DEFAULT_QUOTE_DEFAULTS.scopeGroups[0].bullets).toEqual(before);
      expect(q.scopeGroups[0].bullets.length).toBe(before.length + 1);
    });

    it("editing included/excluded leaves the defaults alone", () => {
      const includedBefore = [...DEFAULT_QUOTE_DEFAULTS.included];
      const excludedBefore = [...DEFAULT_QUOTE_DEFAULTS.excluded];
      const q = createEmptyQuote();
      q.included.push("Extra inclusion");
      q.excluded.splice(0, 1);
      expect(DEFAULT_QUOTE_DEFAULTS.included).toEqual(includedBefore);
      expect(DEFAULT_QUOTE_DEFAULTS.excluded).toEqual(excludedBefore);
    });

    it("gives two quotes independent scope groups", () => {
      const a = createEmptyQuote();
      const b = createEmptyQuote();
      expect(a.scopeGroups).not.toBe(b.scopeGroups);
      expect(a.scopeGroups[0]).not.toBe(b.scopeGroups[0]);
      expect(a.scopeGroups[0].bullets).not.toBe(b.scopeGroups[0].bullets);

      a.scopeGroups[0].bullets.push("only on a");
      expect(b.scopeGroups[0].bullets).not.toContain("only on a");
    });

    it("copies the same content it refuses to share", () => {
      const q = createEmptyQuote();
      expect(q.scopeGroups).toEqual(DEFAULT_QUOTE_DEFAULTS.scopeGroups);
      expect(q.included).toEqual(DEFAULT_QUOTE_DEFAULTS.included);
      expect(q.excluded).toEqual(DEFAULT_QUOTE_DEFAULTS.excluded);
    });
  });

  it("gives each quote its own line item identity", () => {
    const a = createEmptyQuote();
    const b = createEmptyQuote();
    expect(a.lineItems[0].id).not.toBe(b.lineItems[0].id);
    expect(a.lineItems[0].amount).toBeUndefined();
  });
});
