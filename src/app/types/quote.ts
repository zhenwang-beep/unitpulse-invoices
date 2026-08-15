/**
 * Service quote model.
 *
 * Mirrors supabase/migrations/20260814000000_create_service_quotes.sql. Field
 * names are camelCase here and snake_case in Postgres; the edge function is the
 * only place that translates between them.
 *
 * Document structure follows the UnitPulse Service Quote template:
 *   header band -> issued by / issued to -> 01 investment summary ->
 *   02 scope of services -> 03 terms -> 04 assumptions & exclusions ->
 *   05 acceptance
 */

/**
 * What can be STORED. `expired` is deliberately absent: it is derived from
 * validUntil by quote_effective_status(), so offering it as a choice let a user
 * persist a value the system computes — after which extending the date would
 * not clear it. One source of truth, and it is the date.
 */
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

export const QUOTE_STATUSES: QuoteStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
];

/** What can be DISPLAYED — the stored status, or `expired` once the date lapses. */
export type EffectiveQuoteStatus = QuoteStatus | "expired";

/**
 * Which transitions the UI should offer. The server enforces this too
 * (transition_quote_status); this list only keeps the UI from proposing a move
 * the server will reject.
 */
export const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent", "accepted", "declined"],
  sent: ["accepted", "declined", "draft"],
  accepted: [],
  declined: [],
};

/** Moves worth a confirmation prompt, with the reason to show. */
export const TRANSITION_WARNINGS: Partial<Record<string, string>> = {
  "draft>accepted":
    "This quote has not been marked as sent. Only do this if the client accepted it outside the app.",
  "sent>draft":
    "Moving this back to draft does not recall the PDF the client already has.",
};

/** One row of Section 01. `amount` is derived, never stored client-side. */
export interface QuoteLineItem {
  id: string;
  position: number;
  serviceName: string;
  description: string;
  quantity: number;
  unitPrice: number;
  /**
   * Server-computed, from the database's GENERATED column. Present on a saved
   * quote and authoritative when it is: Postgres numeric and JavaScript binary
   * floats disagree even on plain 2-decimal input — 1.01 x 18.50 is 18.69 in
   * the database and 18.68 in JS, because 18.685 * 100 is 1868.4999... So a
   * saved document must render what was stored, not what the browser recomputes.
   */
  amount?: number;
}

/** One block of Section 02 — a titled group of scope bullets. */
export interface ScopeGroup {
  id: string;
  title: string;
  /** Small label under the title, e.g. "SEO / GEO", "Planning". */
  category: string;
  bullets: string[];
}

export interface Quote {
  id: string;
  userId?: string;
  createdByEmail?: string;

  quoteNumber: string;
  status: QuoteStatus;
  /**
   * Server-computed. Expiry is a function of validUntil, and the database owns
   * that definition (quote_effective_status) so the API, the list and any
   * future report cannot drift apart — a browser deriving it locally disagrees
   * with the server around midnight in any non-UTC timezone. Absent on an
   * unsaved draft, where the stored status is the only truth there is.
   */
  effectiveStatus?: EffectiveQuoteStatus;

  // Issued to
  clientName: string;
  clientContactName: string;
  clientContactTitle: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;

  // Issued by
  issuerName: string;
  issuerEmail: string;
  issuerPhone: string;

  // Dark header band
  serviceLine: string;
  preparedForAddress: string;

  // Dates — ISO yyyy-mm-dd
  quoteDate: string;
  validUntil: string;
  serviceStartDate: string;

  // Section 03
  initialTermMonths: number | null;
  renewalTerms: string;
  cancellationTerms: string;
  billingCadence: string;
  paymentTerms: string;
  priceChangeTerms: string;
  quoteValidityTerms: string;

  // Section 01
  currency: string;
  lineItems: QuoteLineItem[];
  setupFee: number;

  // Sections 02 / 04
  scopeGroups: ScopeGroup[];
  included: string[];
  excluded: string[];
  assumptionsNote: string;
  notes: string;

  /** Server-computed totals. See QuoteLineItem.amount for why these win. */
  subtotal?: number;
  totalMonthly?: number;
  initialAmountDue?: number;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * Boilerplate that a new quote inherits. Stored alongside company settings so
 * it can be edited once and picked up by every future quote.
 */
export interface QuoteDefaults {
  serviceLine: string;
  issuerName: string;
  issuerEmail: string;
  issuerPhone: string;
  validityDays: number;
  initialTermMonths: number;
  renewalTerms: string;
  cancellationTerms: string;
  billingCadence: string;
  paymentTerms: string;
  priceChangeTerms: string;
  quoteValidityTerms: string;
  scopeGroups: ScopeGroup[];
  included: string[];
  excluded: string[];
  assumptionsNote: string;
}

// ---------------------------------------------------------------------------
// Money
//
// Every amount is rounded to cents at the point of computation. Summing raw
// floats and rounding only at the end lets representation error reach the
// displayed total, and the PDF, the preview and the stored row must all agree
// to the cent.
// ---------------------------------------------------------------------------

export const roundMoney = (n: number): number =>
  Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export const lineAmount = (item: Pick<QuoteLineItem, "quantity" | "unitPrice">): number =>
  roundMoney((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));

export const quoteSubtotal = (items: QuoteLineItem[]): number =>
  roundMoney(items.reduce((sum, item) => sum + lineAmount(item), 0));

/**
 * What the client pays every month. A one-time setup fee is deliberately NOT
 * part of this: folding it in would print "$899 TOTAL DUE MONTHLY" for a $399
 * service with a $500 setup fee, overstating the recurring charge on a document
 * the client signs. The template lists the setup fee as its own line for exactly
 * this reason.
 */
export const monthlyRecurringTotal = (items: QuoteLineItem[]): number =>
  quoteSubtotal(items);

/** What the client pays up front — the first month plus any one-time fee. */
export const initialAmountDue = (items: QuoteLineItem[], setupFee: number): number =>
  roundMoney(quoteSubtotal(items) + (Number(setupFee) || 0));

// ---------------------------------------------------------------------------
// Display totals.
//
// Prefer what the database stored; fall back to local arithmetic only for a
// draft the server has never seen. This is what keeps a downloaded PDF equal
// to the record to the cent.
// ---------------------------------------------------------------------------

export const displayLineAmount = (item: QuoteLineItem): number =>
  typeof item.amount === "number" ? item.amount : lineAmount(item);

export const displaySubtotal = (q: Quote): number =>
  typeof q.subtotal === "number" ? q.subtotal : quoteSubtotal(q.lineItems);

export const displayMonthly = (q: Quote): number =>
  typeof q.totalMonthly === "number"
    ? q.totalMonthly
    : monthlyRecurringTotal(q.lineItems);

export const displayDueAtSigning = (q: Quote): number =>
  typeof q.initialAmountDue === "number"
    ? q.initialAmountDue
    : initialAmountDue(q.lineItems, q.setupFee);

/** Template rule: zero renders as 0; an em-dash means the value is unknown. */
export const formatMoney = (n: number | null | undefined, currency = "USD"): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${roundMoney(Number(n)).toFixed(2)}`;
};

/** Same rule for any non-money field. */
export const orDash = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s === "" ? "—" : s;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a strict yyyy-mm-dd into a LOCAL date, or null.
 *
 * Two traps this closes. `new Date("2026-08-20")` is midnight UTC, which renders
 * as the previous day anywhere west of Greenwich. And the Date constructor
 * silently normalises overflow, so "2026-02-31" would become March 3 — the
 * round-trip check below rejects it instead of inventing a date.
 */
export const parseISODate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const m = ISO_DATE.exec(iso.trim());
  if (!m) return null;
  const [, ys, ms, ds] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null;
  }
  return dt;
};

export const formatQuoteDate = (iso: string | null | undefined): string => {
  const dt = parseISODate(iso);
  if (!dt) return "—";
  return dt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export const addDays = (iso: string, days: number): string => {
  const dt = parseISODate(iso);
  if (!dt) return toISODate(new Date());
  dt.setDate(dt.getDate() + days);
  return toISODate(dt);
};

export const toISODate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const newId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

/**
 * Quote numbers are allocated by the database on first save, not here.
 * A browser-side random 4-digit number collides roughly 42% of the time within
 * 100 quotes against the UNIQUE(user_id, quote_number) constraint; the server
 * allocates the next number per user and year and retries on conflict.
 */
export const QUOTE_NUMBER_PENDING = "";

// ---------------------------------------------------------------------------
// Template defaults, transcribed from the UnitPulse Service Quote doc.
// ---------------------------------------------------------------------------

export const DEFAULT_QUOTE_DEFAULTS: QuoteDefaults = {
  serviceLine: "GoAiden by UnitPulse  ·  AI marketing & content engagement",
  issuerName: "",
  issuerEmail: "",
  issuerPhone: "",
  validityDays: 30,
  initialTermMonths: 3,
  renewalTerms: "Auto-renews month-to-month at the end of the initial term",
  cancellationTerms:
    "30 days' written notice, effective at the end of the then-current billing month",
  billingCadence: "Monthly in advance, invoiced on the 1st of each month",
  paymentTerms: "Net 30 from invoice date, by ACH / check / card",
  priceChangeTerms:
    "Fixed for the initial term; any change thereafter requires 30 days' notice",
  quoteValidityTerms: "30 days from the quote date shown above",
  scopeGroups: [
    {
      id: "scope-search",
      title: "Search & AI visibility",
      category: "SEO / GEO",
      bullets: [
        "Full SEO and GEO assessment of the property's web presence",
        "Local search optimization recommendations, prioritized by expected lift",
        "Visibility monitoring across AI answer engines and traditional search",
      ],
    },
    {
      id: "scope-strategy",
      title: "Marketing strategy",
      category: "Planning",
      bullets: [
        "Custom strategy built to the property's demographics and lease-up stage",
        "Monthly plan review with recommendations drawn from the property's own data",
      ],
    },
    {
      id: "scope-content",
      title: "Content production",
      category: "Creative",
      bullets: [
        "Image editing and retouching of property photography",
        "Poster and flyer design for on-site and digital placement",
        "Copywriting for listings, ads, and social captions",
        "Short-form video creation",
      ],
    },
    {
      id: "scope-social",
      title: "Social management",
      category: "Distribution",
      bullets: [
        "End-to-end management of connected social accounts",
        "Regular scheduled posting on an agreed cadence",
      ],
    },
  ],
  included: [
    "Onboarding and account connection setup",
    "All content production described in Section 02",
    "Monthly performance reporting",
    "Email support with 1 business day response",
  ],
  excluded: [
    "Paid media spend (billed directly by the ad platform)",
    "Professional photography or videography shoots on site",
    "Website development or hosting",
    "Third-party licensing, stock media, or listing-syndication fees",
  ],
  assumptionsNote:
    "This quote assumes the client provides administrative access to the property's social, Google Business, and listing accounts within 5 business days of signature. Delays in access shift the service start date without changing the fee.",
};

/** The standing line under Section 02 — part of the design, not decoration. */
export const APPROVAL_LINE =
  "Your data only · you approve everything.";

export const SCOPE_FOOTNOTE =
  "Recommendations are generated from the property's own performance data, and every outbound item is queued for human approval before it publishes.";

export const AMOUNTS_FOOTNOTE =
  "All amounts in USD. Prices exclude applicable taxes. A dash (—) means a value is not yet known; a zero means the amount is genuinely zero.";

export const ACCEPTANCE_NOTE =
  "By signing below, both parties agree to the services, pricing, and terms set out in this quote. Countersigned copies will be returned to each signatory.";

export function createEmptyQuote(defaults: QuoteDefaults = DEFAULT_QUOTE_DEFAULTS): Quote {
  const today = toISODate(new Date());
  return {
    id: "",
    quoteNumber: QUOTE_NUMBER_PENDING,
    status: "draft",
    clientName: "",
    clientContactName: "",
    clientContactTitle: "",
    clientEmail: "",
    clientPhone: "",
    clientAddress: "",
    issuerName: defaults.issuerName,
    issuerEmail: defaults.issuerEmail,
    issuerPhone: defaults.issuerPhone,
    serviceLine: defaults.serviceLine,
    preparedForAddress: "",
    quoteDate: today,
    validUntil: addDays(today, defaults.validityDays ?? 30),
    serviceStartDate: "",
    initialTermMonths: defaults.initialTermMonths ?? null,
    renewalTerms: defaults.renewalTerms,
    cancellationTerms: defaults.cancellationTerms,
    billingCadence: defaults.billingCadence,
    paymentTerms: defaults.paymentTerms,
    priceChangeTerms: defaults.priceChangeTerms,
    quoteValidityTerms: defaults.quoteValidityTerms,
    currency: "USD",
    lineItems: [
      {
        id: newId(),
        position: 0,
        serviceName: "GoAiden",
        description:
          "AI marketing team — strategy, content production, social management",
        quantity: 1,
        unitPrice: 399,
      },
    ],
    setupFee: 0,
    // Deep-copied: a new quote must never alias the defaults object, or editing
    // one quote's scope would mutate the saved boilerplate.
    scopeGroups: defaults.scopeGroups.map((g) => ({ ...g, bullets: [...g.bullets] })),
    included: [...defaults.included],
    excluded: [...defaults.excluded],
    assumptionsNote: defaults.assumptionsNote,
    notes: "",
  };
}
