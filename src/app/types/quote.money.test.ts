import { describe, expect, it } from "vitest";
import {
  createEmptyQuote,
  displayDueAtSigning,
  displayLineAmount,
  displayMonthly,
  displaySubtotal,
  formatMoney,
  initialAmountDue,
  lineAmount,
  monthlyRecurringTotal,
  orDash,
  quoteSubtotal,
  roundMoney,
  type Quote,
  type QuoteLineItem,
} from "./quote";

/**
 * A line item with only the fields the money helpers read. `amount` is left off
 * unless a test is specifically about the stored-value path.
 */
const line = (
  quantity: number,
  unitPrice: number,
  amount?: number,
): QuoteLineItem => ({
  id: `line-${quantity}-${unitPrice}`,
  position: 0,
  serviceName: "GoAiden",
  description: "",
  quantity,
  unitPrice,
  ...(amount === undefined ? {} : { amount }),
});

const quoteWith = (patch: Partial<Quote>): Quote => ({
  ...createEmptyQuote(),
  ...patch,
});

/**
 * The case the whole stored-amount design exists for. Postgres numeric computes
 * 1.01 * 18.50 as 18.69; JavaScript gets 18.68 because 18.685 * 100 lands on
 * 1868.4999999999998 and rounds down. Any assertion below that uses these two
 * constants is checking which of the two the code chose to trust.
 */
const JS_COMPUTED = 18.68;
const PG_STORED = 18.69;

describe("roundMoney", () => {
  it("collapses binary-float noise to two decimals", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(0.07 * 3)).toBe(0.21);
  });

  it("rounds 18.685 DOWN, which is where it diverges from Postgres numeric", () => {
    // Not a preference — a fact about the input. 18.685 has no exact binary
    // representation, and the value JS holds is fractionally below it.
    expect(roundMoney(18.685)).toBe(JS_COMPUTED);
    expect(roundMoney(18.685)).not.toBe(PG_STORED);
  });

  it("treats non-finite input as zero rather than propagating NaN", () => {
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
    expect(roundMoney(-Infinity)).toBe(0);
  });

  it("keeps values that are already exact", () => {
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(399)).toBe(399);
    expect(roundMoney(-12.5)).toBe(-12.5);
  });
});

describe("lineAmount", () => {
  it("multiplies quantity by unit price and rounds to cents", () => {
    expect(lineAmount(line(3, 19.99))).toBe(59.97);
    expect(lineAmount(line(1, 399))).toBe(399);
  });

  it("returns 0 when either factor is missing or unparseable", () => {
    expect(lineAmount({ quantity: NaN, unitPrice: 10 })).toBe(0);
    expect(lineAmount({ quantity: 2, unitPrice: NaN })).toBe(0);
    expect(
      lineAmount({ quantity: undefined, unitPrice: 10 } as unknown as QuoteLineItem),
    ).toBe(0);
  });

  it("coerces numeric strings, which is what a bound number input yields", () => {
    expect(
      lineAmount({ quantity: "2", unitPrice: "18.50" } as unknown as QuoteLineItem),
    ).toBe(37);
  });

  it("ignores any stored amount — it computes, it does not read", () => {
    // The stored/computed split is displayLineAmount's job. lineAmount must
    // stay a pure calculation so the two paths can be compared.
    expect(lineAmount(line(1.01, 18.5, PG_STORED))).toBe(JS_COMPUTED);
  });
});

describe("quoteSubtotal", () => {
  it("is 0 for a quote with no lines", () => {
    expect(quoteSubtotal([])).toBe(0);
  });

  it("rounds each line before summing, not once at the end", () => {
    // Two identical 1.01 x 18.50 lines. Rounding per line gives 18.68 + 18.68
    // = 37.36; summing raw and rounding once gives 37.37. The difference is
    // what makes a printed column of amounts add up to the printed total.
    const items = [line(1.01, 18.5), line(1.01, 18.5)];
    expect(quoteSubtotal(items)).toBe(37.36);
    expect(quoteSubtotal(items)).not.toBe(roundMoney(18.685 * 2));
  });

  it("adds ordinary lines exactly", () => {
    expect(quoteSubtotal([line(1, 399), line(2, 150.5), line(3, 19.99)])).toBe(
      759.97,
    );
  });
});

describe("monthlyRecurringTotal vs initialAmountDue", () => {
  const service = [line(1, 399)];
  const SETUP_FEE = 500;

  it("excludes the setup fee from the recurring total", () => {
    // The document the client signs says "TOTAL DUE MONTHLY". Printing 899
    // there for a $399 service would overstate the recurring charge by the
    // one-time fee, every month, forever.
    expect(monthlyRecurringTotal(service)).toBe(399);
    expect(monthlyRecurringTotal(service)).not.toBe(899);
  });

  it("includes the setup fee in the amount due at signing", () => {
    expect(initialAmountDue(service, SETUP_FEE)).toBe(899);
  });

  it("makes the two totals differ by exactly the setup fee", () => {
    expect(
      roundMoney(initialAmountDue(service, SETUP_FEE) - monthlyRecurringTotal(service)),
    ).toBe(SETUP_FEE);
  });

  it("collapses to the same number when there is no setup fee", () => {
    expect(initialAmountDue(service, 0)).toBe(monthlyRecurringTotal(service));
  });

  it("treats a missing or unparseable setup fee as zero, not NaN", () => {
    expect(initialAmountDue(service, NaN)).toBe(399);
    expect(initialAmountDue(service, undefined as unknown as number)).toBe(399);
  });

  it("rounds the sum, so a sub-cent fee cannot leak extra decimals into the total", () => {
    expect(initialAmountDue([line(1, 399)], 0.004)).toBe(399);
    expect(initialAmountDue([line(1, 399)], 0.006)).toBe(399.01);
  });
});

describe("displayLineAmount", () => {
  it("renders the stored server amount, not the browser's recomputation", () => {
    const stored = line(1.01, 18.5, PG_STORED);
    expect(displayLineAmount(stored)).toBe(PG_STORED);
    expect(displayLineAmount(stored)).not.toBe(lineAmount(stored));
  });

  it("falls back to local arithmetic only when no amount was stored", () => {
    expect(displayLineAmount(line(1.01, 18.5))).toBe(JS_COMPUTED);
  });

  it("honours a stored zero instead of recomputing it away", () => {
    // A comped line is legitimately 0 on the server. A truthiness check here
    // would silently reprice it at 50.
    expect(displayLineAmount(line(5, 10, 0))).toBe(0);
  });

  it("falls back when amount is null, which is what an absent column serialises to", () => {
    const nulled = { ...line(5, 10), amount: null } as unknown as QuoteLineItem;
    expect(displayLineAmount(nulled)).toBe(50);
  });

  it("does not second-guess a stored amount that disagrees with quantity x price", () => {
    // A server-side discount or proration is still the authoritative number.
    expect(displayLineAmount(line(10, 100, 750))).toBe(750);
  });
});

describe("display totals prefer the stored row", () => {
  const items = [line(1.01, 18.5)];

  it("displaySubtotal uses the server subtotal over the local sum", () => {
    const q = quoteWith({ lineItems: items, subtotal: PG_STORED });
    expect(displaySubtotal(q)).toBe(PG_STORED);
    expect(displaySubtotal(q)).not.toBe(quoteSubtotal(items));
  });

  it("displaySubtotal computes locally for a draft the server has never seen", () => {
    const q = quoteWith({ lineItems: items, subtotal: undefined });
    expect(displaySubtotal(q)).toBe(JS_COMPUTED);
  });

  it("displayMonthly uses the server total and still excludes the setup fee", () => {
    const q = quoteWith({
      lineItems: [line(1, 399)],
      setupFee: 500,
      totalMonthly: 399,
      initialAmountDue: 899,
    });
    expect(displayMonthly(q)).toBe(399);
    expect(displayDueAtSigning(q)).toBe(899);
  });

  it("displayMonthly computes locally when the server total is absent", () => {
    const q = quoteWith({
      lineItems: [line(1, 399)],
      setupFee: 500,
      totalMonthly: undefined,
    });
    expect(displayMonthly(q)).toBe(399);
  });

  it("displayDueAtSigning uses the server value over subtotal plus fee", () => {
    const q = quoteWith({
      lineItems: [line(1, 399)],
      setupFee: 500,
      initialAmountDue: 849, // e.g. a waived portion recorded server-side
    });
    expect(displayDueAtSigning(q)).toBe(849);
  });

  it("displayDueAtSigning computes locally when the server value is absent", () => {
    const q = quoteWith({
      lineItems: [line(1, 399)],
      setupFee: 500,
      initialAmountDue: undefined,
    });
    expect(displayDueAtSigning(q)).toBe(899);
  });

  it("honours stored zeros on every total", () => {
    const q = quoteWith({
      lineItems: [line(1, 399)],
      setupFee: 500,
      subtotal: 0,
      totalMonthly: 0,
      initialAmountDue: 0,
    });
    expect(displaySubtotal(q)).toBe(0);
    expect(displayMonthly(q)).toBe(0);
    expect(displayDueAtSigning(q)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("renders a genuine zero as $0.00, never as a dash", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-0)).toBe("$0.00");
  });

  it("renders an unknown value as an em-dash", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
    expect(formatMoney(Infinity)).toBe("—");
  });

  it("always shows two decimals", () => {
    expect(formatMoney(399)).toBe("$399.00");
    expect(formatMoney(18.5)).toBe("$18.50");
    expect(formatMoney(PG_STORED)).toBe("$18.69");
  });

  it("prints the stored cent, not a re-derived one", () => {
    expect(formatMoney(PG_STORED)).not.toBe(formatMoney(JS_COMPUTED));
  });

  it("drops the symbol for a non-USD currency rather than mislabelling it", () => {
    expect(formatMoney(399, "EUR")).toBe("399.00");
    expect(formatMoney(0, "EUR")).toBe("0.00");
  });

  it("keeps the sign on a negative amount", () => {
    expect(formatMoney(-25)).toBe("$-25.00");
  });
});

describe("orDash", () => {
  it("renders zero as 0 — a known amount, not an unknown one", () => {
    expect(orDash(0)).toBe("0");
  });

  it("renders empty and missing values as an em-dash", () => {
    expect(orDash("")).toBe("—");
    expect(orDash("   ")).toBe("—");
    expect(orDash(null)).toBe("—");
    expect(orDash(undefined)).toBe("—");
  });

  it("trims but otherwise preserves real text", () => {
    expect(orDash("  Riverbend Apartments  ")).toBe("Riverbend Apartments");
    expect(orDash("Net 30")).toBe("Net 30");
  });

  it("stringifies numbers without reformatting them", () => {
    expect(orDash(3)).toBe("3");
    expect(orDash(-1)).toBe("-1");
  });
});
