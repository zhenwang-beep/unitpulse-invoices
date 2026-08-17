import { describe, expect, it } from "vitest";
import { addDays, formatQuoteDate, parseISODate, toISODate } from "./quote";

/**
 * These helpers exist to keep a quote date off by zero days in every timezone.
 * Two failure modes are being guarded:
 *
 *   1. `new Date("2026-08-20")` is parsed as midnight UTC, which is the 19th
 *      anywhere west of Greenwich. Every assertion below reads the LOCAL
 *      calendar fields, so a UTC-based implementation fails them outside UTC.
 *   2. The Date constructor normalises overflow, so "2026-02-31" would quietly
 *      become March 3rd. An invented date on a signed document is worse than a
 *      dash, so these must be rejected.
 */
describe("parseISODate", () => {
  it("returns the same calendar day it was given, at local midnight", () => {
    const dt = parseISODate("2026-08-20")!;
    expect(dt).not.toBeNull();
    expect(dt.getFullYear()).toBe(2026);
    expect(dt.getMonth()).toBe(7); // August
    expect(dt.getDate()).toBe(20);
    expect(dt.getHours()).toBe(0);
    expect(dt.getMinutes()).toBe(0);
  });

  it("does not shift a day the way the built-in UTC parse does", () => {
    const naive = new Date("2026-08-20");
    const parsed = parseISODate("2026-08-20")!;
    // In UTC these agree; anywhere west of Greenwich the naive one is the 19th.
    // Asserting on the local getters is what makes this meaningful everywhere.
    expect(parsed.getDate()).toBe(20);
    if (naive.getTimezoneOffset() > 0) {
      expect(naive.getDate()).not.toBe(parsed.getDate());
    }
  });

  it("rejects a day that does not exist in that month instead of rolling over", () => {
    // The Date constructor would hand back March 3rd for this.
    expect(parseISODate("2026-02-31")).toBeNull();
    expect(parseISODate("2026-04-31")).toBeNull();
    expect(parseISODate("2026-06-31")).toBeNull();
  });

  it("rejects an out-of-range month instead of rolling into the next year", () => {
    // "2026-13-01" would become January 2027.
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("2026-00-10")).toBeNull();
  });

  it("rejects day zero", () => {
    expect(parseISODate("2026-08-00")).toBeNull();
  });

  it("knows which years actually have a February 29th", () => {
    expect(parseISODate("2026-02-29")).toBeNull();
    expect(parseISODate("2100-02-29")).toBeNull(); // century, not a leap year
    expect(parseISODate("2024-02-29")?.getDate()).toBe(29);
    expect(parseISODate("2000-02-29")?.getDate()).toBe(29); // divisible by 400
  });

  it("requires strict zero-padded yyyy-mm-dd", () => {
    expect(parseISODate("2026-8-20")).toBeNull();
    expect(parseISODate("08/20/2026")).toBeNull();
    expect(parseISODate("2026-08-20T00:00:00Z")).toBeNull();
    expect(parseISODate("20260820")).toBeNull();
    expect(parseISODate("not a date")).toBeNull();
  });

  it("returns null for missing input rather than defaulting to today", () => {
    expect(parseISODate(null)).toBeNull();
    expect(parseISODate(undefined)).toBeNull();
    expect(parseISODate("")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseISODate("  2026-08-20  ")?.getDate()).toBe(20);
  });
});

describe("formatQuoteDate", () => {
  it("renders a valid date on its own calendar day", () => {
    expect(formatQuoteDate("2026-08-20")).toBe("August 20, 2026");
  });

  it("does not slip across a month or year boundary", () => {
    // The days a UTC off-by-one would visibly corrupt: Jan 1 becoming Dec 31
    // of the previous year is the worst version of this bug.
    expect(formatQuoteDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatQuoteDate("2026-12-31")).toBe("December 31, 2026");
    expect(formatQuoteDate("2026-03-01")).toBe("March 1, 2026");
  });

  it("shows a dash for an impossible date rather than inventing one", () => {
    expect(formatQuoteDate("2026-02-31")).toBe("—");
    expect(formatQuoteDate("2026-13-01")).toBe("—");
    expect(formatQuoteDate("2026-02-31")).not.toContain("March");
    expect(formatQuoteDate("2026-13-01")).not.toContain("2027");
  });

  it("shows a dash for an unset date", () => {
    expect(formatQuoteDate("")).toBe("—");
    expect(formatQuoteDate(null)).toBe("—");
    expect(formatQuoteDate(undefined)).toBe("—");
  });
});

describe("toISODate", () => {
  it("zero-pads month and day", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 8, 9))).toBe("2026-09-09");
  });

  it("uses local calendar fields, so it round-trips with parseISODate", () => {
    for (const iso of [
      "2026-01-01",
      "2026-02-28",
      "2024-02-29",
      "2026-06-15",
      "2026-11-01",
      "2026-12-31",
    ]) {
      expect(toISODate(parseISODate(iso)!)).toBe(iso);
    }
  });

  it("reads the local clock at any hour, not the UTC one", () => {
    // The round-trip above only ever hands toISODate a LOCAL MIDNIGHT, and
    // local midnight falls on the same UTC calendar day everywhere west of
    // Greenwich — so a getUTC* implementation passes it in half the world,
    // including US timezones. These two times of day pin it everywhere: 23:30
    // local is already tomorrow in UTC west of Greenwich, 00:30 local is still
    // yesterday in UTC east of it. That matters because createEmptyQuote()
    // dates a quote with toISODate(new Date()) — a UTC-based version would
    // stamp tomorrow's date on a quote written at 5pm in California.
    expect(toISODate(new Date(2026, 5, 15, 23, 30))).toBe("2026-06-15");
    expect(toISODate(new Date(2026, 5, 15, 0, 30))).toBe("2026-06-15");
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-08-20", 30)).toBe("2026-09-19");
  });

  it("crosses a year boundary in both directions", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-06-15", 365)).toBe("2027-06-15");
  });

  it("respects whether February has 29 days", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
  });

  it("advances exactly one calendar day across a DST change", () => {
    // Adding 86_400_000 milliseconds instead of incrementing the date field
    // lands on Nov 1st 23:00 in US timezones — the same day it started.
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("returns the input day for a zero offset", () => {
    expect(addDays("2026-08-20", 0)).toBe("2026-08-20");
  });

  it("falls back to today when the base date is unusable", () => {
    const today = toISODate(new Date());
    expect(addDays("", 30)).toBe(today);
    expect(addDays("not a date", 30)).toBe(today);
    // Crucially it does NOT roll 2026-02-31 forward to March and add from there.
    expect(addDays("2026-02-31", 1)).toBe(today);
  });

  it("does not mutate anything the caller can observe between calls", () => {
    const base = "2026-08-20";
    expect(addDays(base, 30)).toBe("2026-09-19");
    expect(addDays(base, 30)).toBe("2026-09-19");
    expect(base).toBe("2026-08-20");
  });
});
