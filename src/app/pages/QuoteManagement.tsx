import React, {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  FileText,
  Download,
  Trash2,
  Search,
  Filter,
  Plus,
  X,
  DollarSign,
  Receipt,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  FilePlus,
  Loader2,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { generateQuotePDF } from "../quote-pdf-generator";
import logoPng from "../../assets/logo.svg";
import type { CompanySettings } from "../App";
import { Navbar } from "../components/Navbar";
import { DateField } from "../components/DateField";
import { fetchAPI } from "../utils/api";
import type { Quote, QuoteStatus, EffectiveQuoteStatus } from "../types/quote";
import {
  QUOTE_STATUSES,
  ALLOWED_TRANSITIONS,
  TRANSITION_WARNINGS,
  formatMoney,
  formatQuoteDate,
  orDash,
  displayMonthly,
  roundMoney,
  toISODate,
  parseISODate,
  addDays,
} from "../types/quote";

/**
 * Status chips carry their label as text — colour is never the only signal.
 * Class strings are written out in full so Tailwind's scanner sees them.
 */
const STATUS_LABELS: Record<EffectiveQuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

/**
 * Token colours only. Each chip differs in fill AND outline, so the five
 * statuses stay apart from one another without inventing a hue: emerald is
 * spent on `accepted` — the affirmative — and nothing else.
 */
const STATUS_CHIP: Record<EffectiveQuoteStatus, string> = {
  draft: "bg-[#F4F4F5] border-[#E4E4E7] text-[#52525C]",
  sent: "bg-white border-[#52525C] text-[#18181B]",
  accepted: "bg-[#E8F4F0] border-[#006045] text-[#006045]",
  declined: "bg-[#18181B] border-[#18181B] text-white",
  expired: "bg-white border-[#E4E4E7] text-[#71717B]",
};

/**
 * What the filter offers, which is what the table can DISPLAY — not what can be
 * stored. `expired` is never a stored status (it is derived from validUntil),
 * but it is the chip a lapsed quote wears, so a filter built from the storable
 * four could not select the rows the user can plainly see.
 */
const FILTER_STATUSES: EffectiveQuoteStatus[] = [...QUOTE_STATUSES, "expired"];

type StatusFilter = "all" | EffectiveQuoteStatus;

const SANS = "Manrope, sans-serif";

/** Gap between an anchor and its popover, and the minimum viewport inset. */
const GAP = 6;
const MARGIN = 8;

/* ------------------------------------------------------------------------ */
/* Quote → invoice links                                                    */
/*                                                                          */
/* One accepted quote bills many times, so the link is a list, not a field.  */
/* Field names are read both ways: the API maps rows to camelCase, but the   */
/* RPC returns the raw row, and a list indicator is not worth breaking over  */
/* which of the two a route happens to hand back.                           */
/* ------------------------------------------------------------------------ */

interface QuoteInvoiceLink {
  invoiceKey: string;
  invoiceNumber: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  invoiceKind: string;
  includesSetupFee: boolean;
}

const normalizeLink = (raw: any): QuoteInvoiceLink => ({
  invoiceKey: String(raw?.invoiceKey ?? raw?.invoice_key ?? ""),
  invoiceNumber: String(raw?.invoiceNumber ?? raw?.invoice_number ?? ""),
  servicePeriodStart: String(
    raw?.servicePeriodStart ?? raw?.service_period_start ?? "",
  ),
  servicePeriodEnd: String(
    raw?.servicePeriodEnd ?? raw?.service_period_end ?? "",
  ),
  invoiceKind: String(raw?.invoiceKind ?? raw?.invoice_kind ?? "recurring"),
  includesSetupFee: Boolean(raw?.includesSetupFee ?? raw?.includes_setup_fee),
});

const readLinks = (data: any): QuoteInvoiceLink[] => {
  const rows = Array.isArray(data)
    ? data
    : (data?.links ?? data?.invoices ?? []);
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeLink)
    .sort((a, b) => a.servicePeriodStart.localeCompare(b.servicePeriodStart));
};

/** A body that is not JSON is not an error worth throwing over. */
const readJSON = async (response: Response): Promise<any> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * The server's own words when it has them. A generic "something went wrong"
 * hides the one thing the user needs here — which of the contractual rules
 * (stale status, already invoiced, wrong status) refused the change.
 */
const errorMessage = (payload: any, fallback: string): string => {
  const message = payload?.error ?? payload?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
};

const firstOfCurrentMonth = (): string => {
  const now = new Date();
  return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
};

/**
 * `start + interval '1 month'`, clamped to the length of the target month the
 * way Postgres clamps it. Plain JS arithmetic does not clamp —
 * new Date(2026, 0, 31 + 31) rolls Jan 31 into early March — so a period
 * starting on the 31st would be shown running days past what the server
 * actually stores.
 */
const addOneMonth = (startISO: string): string => {
  const start = parseISODate(startISO);
  if (!start) return startISO;
  const y = start.getFullYear();
  const m = start.getMonth() + 1;
  const daysInTarget = new Date(y, m + 1, 0).getDate();
  return toISODate(new Date(y, m, Math.min(start.getDate(), daysInTarget)));
};

/**
 * The last day of the service period, computed the way Postgres computes it:
 * `start + interval '1 month' - interval '1 day'`. Display only; the stored
 * value is the record.
 */
const servicePeriodEnd = (startISO: string): string => {
  const end = parseISODate(addOneMonth(startISO));
  if (!end) return "";
  end.setDate(end.getDate() - 1);
  return toISODate(end);
};

/**
 * A period's identity is its start date: UNIQUE (quote_id,
 * service_period_start) means one invoice per month per quote, so two rows
 * sharing a start are the same invoice however each arrived — one from the
 * list route in camelCase, one straight off the RPC in snake_case.
 */
const linkKey = (link: QuoteInvoiceLink): string =>
  link.servicePeriodStart || link.invoiceKey || link.invoiceNumber;

const mergeLinks = (
  base: QuoteInvoiceLink[],
  extra: QuoteInvoiceLink[],
): QuoteInvoiceLink[] => {
  const byPeriod = new Map(base.map((link) => [linkKey(link), link]));
  for (const link of extra) byPeriod.set(linkKey(link), link);
  return Array.from(byPeriod.values()).sort((a, b) =>
    a.servicePeriodStart.localeCompare(b.servicePeriodStart),
  );
};

/**
 * The first month at or after `fromISO` that this quote has not been billed
 * for. Walks forward a month at a time rather than jumping to "last + 1", so a
 * gap left by a skipped month is offered before the end of the run. Capped
 * because a malformed date would otherwise never advance.
 */
const nextUnbilledPeriod = (
  fromISO: string,
  billed: ReadonlySet<string>,
): string => {
  let candidate = fromISO;
  for (let i = 0; i < 120 && billed.has(candidate); i++) {
    const next = addOneMonth(candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return candidate;
};

/** Everything focusable by Tab, in document order. */
const TABBABLE =
  'a[href],area[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

const tabbablesIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0,
  );

/**
 * The toast region, which is exempt from the treatment below. It is the only
 * channel this page has for saying what just happened, and the create-invoice
 * dialog raises toasts carrying actions of their own while it stays open — an
 * inert one would announce nothing and click nowhere.
 */
const LIVE_REGION = "[data-sonner-toaster],[aria-live]";

const isLiveRegion = (el: Element): boolean =>
  el.matches(LIVE_REGION) || Boolean(el.querySelector(LIVE_REGION));

/**
 * Make everything outside `el` inert for as long as a dialog is open, and
 * return the undo. `aria-modal` alone is a promise to assistive tech that the
 * browser does not enforce: without this, Tab still walks the page behind the
 * overlay, and a screen reader still reads the table through it.
 *
 * Walks up from the dialog marking each ancestor's other children, and restores
 * exactly what it changed — an element that was already inert stays inert, and
 * an aria-hidden that was already set keeps its own value.
 */
const inertOthers = (el: HTMLElement): (() => void) => {
  const changed: Array<{ node: HTMLElement; ariaHidden: string | null }> = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue;
      if (!(sibling instanceof HTMLElement)) continue;
      if (isLiveRegion(sibling)) continue;
      if (sibling.hasAttribute("inert")) continue;
      changed.push({ node: sibling, ariaHidden: sibling.getAttribute("aria-hidden") });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    node = parent;
  }
  return () => {
    for (const { node: el2, ariaHidden } of changed) {
      el2.removeAttribute("inert");
      if (ariaHidden === null) el2.removeAttribute("aria-hidden");
      else el2.setAttribute("aria-hidden", ariaHidden);
    }
  };
};

/** "Mark as sent" / "Move back to draft" — a verb, not a bare status name. */
const transitionLabel = (to: QuoteStatus): string =>
  to === "draft" ? "Move back to draft" : `Mark as ${STATUS_LABELS[to].toLowerCase()}`;

/**
 * Apply what the server said about a quote's lifecycle, and nothing else.
 *
 * transition_quote_status returns the quotes row, which does not carry line
 * items. Copying the payload wholesale would therefore blank the money already
 * on screen if the route ever passes the row straight through, so only the
 * lifecycle fields cross over — they are the only ones a status change can
 * have altered.
 */
const applyStatusPayload = (existing: Quote, payload: any): Quote => {
  if (!payload || typeof payload !== "object") return existing;
  const next: Quote = { ...existing };

  const stored = payload.status;
  if (typeof stored === "string" && (QUOTE_STATUSES as string[]).includes(stored)) {
    next.status = stored as QuoteStatus;
  }

  const effective = payload.effectiveStatus ?? payload.effective_status;
  if (typeof effective === "string") {
    next.effectiveStatus = effective as EffectiveQuoteStatus;
  } else if (next.status !== existing.status) {
    // Rather than keep an effective status computed against the old stored
    // one, drop it and let the local fallback derive from validUntil.
    next.effectiveStatus = undefined;
  }

  const updated = payload.updatedAt ?? payload.updated_at;
  if (typeof updated === "string") next.updatedAt = updated;

  return next;
};

/** Colour is the second signal; the label is the first. */
function StatusChip({
  status,
  note,
}: {
  status: EffectiveQuoteStatus;
  note?: string;
}) {
  return (
    <span
      className={`inline-flex items-center border px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_CHIP[status]}`}
      style={{ fontFamily: SANS }}
      title={note}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The same chip, as a control. Rendered only where a transition is actually
 * available — an expired or closed quote gets the plain chip above, because a
 * button that opens an empty menu is a promise the row cannot keep.
 */
function StatusChipButton({
  status,
  quoteNumber,
  pending,
  open,
  onOpen,
}: {
  status: EffectiveQuoteStatus;
  quoteNumber: string;
  pending: boolean;
  open: boolean;
  onOpen: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      // The row is click-to-edit; opening the menu must not also navigate.
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      disabled={pending}
      aria-haspopup="menu"
      aria-expanded={open}
      title={`Change the status of quote ${quoteNumber}`}
      aria-label={`Status: ${STATUS_LABELS[status]}. Change the status of quote ${quoteNumber}`}
      className={`inline-flex items-center gap-1 border px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#006045] disabled:cursor-wait disabled:opacity-70 ${STATUS_CHIP[status]}`}
      style={{ fontFamily: SANS }}
    >
      {pending && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
      {STATUS_LABELS[status]}
      <ChevronDown className="w-3 h-3" aria-hidden="true" />
    </button>
  );
}

/**
 * The transition menu.
 *
 * Portalled to document.body and positioned `fixed`, for the same reason
 * DateField is: the table scrolls (`overflow-x-auto`) inside a card that clips
 * (`overflow-hidden`), and an absolutely-positioned menu is cut off by the
 * nearest such ancestor. The cost is having to track the anchor on scroll and
 * resize by hand.
 *
 * It is rendered from the page root rather than from inside the row, because
 * React events cross a portal along the React tree, not the DOM tree — a menu
 * mounted inside the <tr> would bubble its clicks into the row's
 * click-to-edit handler.
 */
function StatusMenu({
  anchor,
  quoteNumber,
  from,
  options,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement;
  quoteNumber: string;
  from: QuoteStatus;
  options: QuoteStatus[];
  onSelect: (to: QuoteStatus) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hasFocused = useRef(false);

  const updatePosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();

    // A fixed menu does not travel with an anchor that has scrolled away; it
    // would hang over unrelated rows as an orphan. Close instead.
    if (
      a.bottom < 0 ||
      a.top > window.innerHeight ||
      a.right < 0 ||
      a.left > window.innerWidth
    ) {
      onClose(false);
      return;
    }

    const below = window.innerHeight - a.bottom;
    const flip = below < m.height + GAP && a.top > below;
    let top = flip ? a.top - m.height - GAP : a.bottom + GAP;
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - m.height - MARGIN));

    let left = a.left;
    if (left + m.width > window.innerWidth - MARGIN) left = a.right - m.width;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - m.width - MARGIN));

    setPos((prev) =>
      prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5
        ? prev
        : { top, left },
    );
  }, [anchor, onClose]);

  // Positioned before paint, so the menu is never seen in the wrong place.
  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    const onMove = () => updatePosition();
    // Capture phase: the scrolling element is the table's own wrapper, and a
    // bubble-phase window listener would never hear about it.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [updatePosition]);

  // Focus the first item once — but only after positioning, since the menu
  // spends its first render hidden while it is measured and a hidden element
  // cannot take focus.
  useEffect(() => {
    if (!pos || hasFocused.current) return;
    hasFocused.current = true;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('button[role="menuitem"]')
      ?.focus({ preventScroll: true });
  }, [pos]);

  /**
   * Outside click. mousedown rather than click so a drag that starts inside
   * and ends outside does not dismiss it. The anchor counts as inside so the
   * chip's own handler can toggle the menu shut rather than reopen it.
   */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchor.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    /**
     * Tab leaves the menu, so the menu closes with it. The items are
     * `tabIndex={-1}` and the menu is portalled to the end of the body, so a Tab
     * that was allowed to stand would strand focus somewhere the user never
     * asked to be while an orphaned menu hung over the table. Focus goes back to
     * the chip, and the default Tab then carries on from there — into the row's
     * own actions, exactly as if the menu had never been opened.
     */
    if (e.key === "Tab") {
      onClose(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (e.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    else if (e.key === "End") next = items.length - 1;
    items[next].focus();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Change the status of quote ${quoteNumber}`}
      onKeyDown={onKeyDown}
      className="fixed z-50 w-60 bg-white rounded-lg border border-[#E4E4E7] p-1"
      style={{
        fontFamily: SANS,
        boxShadow: "0 10px 28px -6px rgba(0,0,0,.14)",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // Hidden for the single render it takes to measure the menu.
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div
        className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-[#71717B]"
        style={{ fontWeight: 700 }}
      >
        Change status
      </div>
      {options.map((to) => {
        const warning = TRANSITION_WARNINGS[`${from}>${to}`];
        const label = transitionLabel(to);
        return (
          <button
            key={to}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(to);
            }}
            title={warning}
            aria-label={warning ? `${label} — ${warning}` : label}
            className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded text-sm text-[#18181B] hover:bg-[#FAFAFA] focus:outline-none focus:bg-[#E8F4F0] focus:text-[#006045] transition-colors cursor-pointer"
            style={{ fontFamily: SANS, fontWeight: 500 }}
          >
            <span>{label}</span>
            {warning && (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#71717B]" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Create-invoice modal.
 *
 * Owns its own copy of the quote's invoice links: the list page caches them,
 * but "is this the first invoice or the fifth" decides what the client is
 * about to be billed, so it is re-read from the server when the modal opens
 * and handed back to the list afterwards.
 */
function CreateInvoiceModal({
  quote,
  seedLinks,
  opener,
  onLinksChange,
  onClose,
  onViewInvoices,
}: {
  quote: Quote;
  seedLinks?: QuoteInvoiceLink[];
  /** The control that opened this, to hand focus back to when it closes. */
  opener?: HTMLElement | null;
  onLinksChange: (quoteId: string, links: QuoteInvoiceLink[]) => void;
  onClose: () => void;
  onViewInvoices: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [links, setLinks] = useState<QuoteInvoiceLink[] | null>(seedLinks ?? null);
  const [linksFailed, setLinksFailed] = useState(false);
  const [periodStart, setPeriodStart] = useState(firstOfCurrentMonth);
  const [issueDate, setIssueDate] = useState(() => toISODate(new Date()));
  const [dueDate, setDueDate] = useState(() => addDays(toISODate(new Date()), 30));
  // Once the user sets a due date by hand, the issue date stops driving it.
  const [dueTouched, setDueTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const currency = quote.currency || "USD";
  const monthly = displayMonthly(quote);
  const setupFee = Number(quote.setupFee) || 0;

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * The page behind an aria-modal dialog must not be reachable at all, and
   * focus must go back where it came from when the dialog leaves.
   *
   * One effect, because the two cleanups are ordered: focus() on an element
   * inside an inert subtree does nothing at all, so the background has to be
   * released before the opener can take focus back. Split in two, the order
   * would depend on which effect happened to be declared first.
   *
   * The opener is read once, on mount, and only refocused if it is still in the
   * document — the row's button is gone entirely if the list reloaded while the
   * dialog was open, and focusing a detached node drops focus onto the body.
   */
  const openerRef = useRef<HTMLElement | null>(opener ?? null);
  useEffect(() => {
    const overlay = overlayRef.current;
    const release = overlay ? inertOthers(overlay) : null;
    return () => {
      release?.();
      const el = openerRef.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchAPI(`/quotes/${quote.id}/invoices`);
        if (!response.ok) throw new Error("Failed to load invoice history");
        const data = await response.json();
        if (cancelled) return;
        const fresh = readLinks(data);
        setLinks(fresh);
        setLinksFailed(false);
        onLinksChange(quote.id, fresh);
      } catch (error) {
        console.error("Error loading quote invoices:", error);
        if (!cancelled) setLinksFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quote.id, onLinksChange]);

  const isInitial = links !== null && links.length === 0;
  const existingForPeriod =
    links?.find((l) => l.servicePeriodStart === periodStart) ?? null;
  const periodEnd = servicePeriodEnd(periodStart);
  const invoiceTotal = roundMoney(monthly + (isInitial ? setupFee : 0));

  const datesOutOfOrder =
    Boolean(issueDate) && Boolean(dueDate) && dueDate < issueDate;
  const canSubmit = Boolean(parseISODate(periodStart)) && !datesOutOfOrder && !submitting;

  const setIssue = (iso: string) => {
    setIssueDate(iso);
    // Net 30 is the house default; it follows the issue date until touched.
    if (!dueTouched) setDueDate(iso ? addDays(iso, 30) : "");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await fetchAPI(`/quotes/${quote.id}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The period is the invoice's identity — it is what the UNIQUE
          // (quote_id, service_period_start) constraint bills against.
          servicePeriodStart: periodStart,
          issueDate: issueDate || null,
          dueDate: dueDate || null,
          notes: notes.trim() || null,
        }),
      });
      const payload = await readJSON(response);

      if (!response.ok) {
        toast.error(errorMessage(payload, "Failed to create the invoice"));
        return;
      }

      // Not an error: asking twice for the same month is exactly what the
      // unique constraint is there to absorb, and the server hands back the
      // invoice that already covers it.
      const existing = payload?.alreadyExists ? normalizeLink(payload.link) : null;

      // Refresh the billing history either way, so the row indicator and the
      // initial/recurring decision are correct next time.
      let fetched: QuoteInvoiceLink[] | null = null;
      try {
        const after = await fetchAPI(`/quotes/${quote.id}/invoices`);
        if (after.ok) fetched = readLinks(await after.json());
      } catch (error) {
        console.error("Error refreshing quote invoices:", error);
      }
      // The returned link is authoritative even when the refresh did not land —
      // but only if it carries something to identify it. An empty one would
      // list a row of em-dashes as though a month had been billed to nobody.
      const merged = mergeLinks(
        fetched ?? links ?? [],
        existing && linkKey(existing) ? [existing] : [],
      );
      onLinksChange(quote.id, merged);

      if (existing) {
        /**
         * A success, so it does not end the task. The dialog stays open with
         * the invoice that already covers this month now listed above, and the
         * period moved on to the first month this quote has NOT been billed
         * for — the next thing the user was going to do anyway, one click away
         * instead of a reopen and a re-pick.
         */
        setLinks(merged);
        setLinksFailed(fetched === null);
        const billed = new Set(merged.map((l) => l.servicePeriodStart));
        // The server has just said this month is taken; that stands even if the
        // link it returned was too thin to say so itself.
        billed.add(periodStart);
        const next = nextUnbilledPeriod(periodStart, billed);
        setPeriodStart(next);
        toast.info(
          `That service period is already invoiced as ${orDash(existing.invoiceNumber)}`,
          {
            description:
              next === periodStart
                ? "Nothing was billed twice. Pick a service period that has not been billed yet."
                : `Nothing was billed twice. The service period has moved on to ${formatQuoteDate(next)} — the next month this quote has not been billed for.`,
            action: { label: "View invoices", onClick: onViewInvoices },
          },
        );
        return;
      }

      const invoice = payload?.invoice ?? payload;
      const number =
        invoice?.invoiceId ?? invoice?.invoiceNumber ?? invoice?.invoice_number ?? "";
      toast.success(`Invoice ${orDash(number)} created`, {
        description: `Billed to ${orDash(quote.clientName)} for the service period starting ${formatQuoteDate(periodStart)}.`,
        action: { label: "View invoices", onClick: onViewInvoices },
      });
      onClose();
    } catch (error) {
      console.error("Error creating invoice from quote:", error);
      toast.error("Failed to create the invoice");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Escape closes; Tab cycles within the dialog and never behind it.
   *
   * Both run on the React tree rather than on document, which is what makes
   * them cooperate with the DateField: its popover is portalled to
   * document.body but is still a React child of this card, so its own Escape
   * handler stops the event and closes the calendar first. For the same reason
   * a Tab pressed inside that popover arrives here — and is left alone, since
   * the popover is outside this card in the DOM and orders its own contents.
   */
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (submitting) return;
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const card = cardRef.current;
    if (!card) return;
    const active = document.activeElement as HTMLElement | null;
    const loose = !active || active === document.body;
    // Focus is in a portalled descendant — the calendar. Its Tab order is its
    // own business, and the popover is the last thing in the document anyway.
    if (!loose && active !== card && !card.contains(active)) return;
    const items = tabbablesIn(card);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    // The card is focused on mount and sits before all of its children, so a
    // forward Tab from it already lands on `first`; only backwards needs help.
    const atStart = loose || active === card;
    if (e.shiftKey) {
      if (atStart || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (loose || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      // Outside click. The date popovers are portalled to document.body, so
      // they are never a target here and picking a day cannot close the modal.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-invoice-title"
        onKeyDown={onCardKeyDown}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2
            id="create-invoice-title"
            className="text-xl"
            style={{ fontFamily: SANS, fontWeight: 700 }}
          >
            Create invoice
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            title="Close"
            aria-label="Close create invoice dialog"
            className="p-1.5 -mr-1.5 -mt-1 text-[#71717B] hover:bg-[#F4F4F5] rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p
          className="text-[#71717B] text-sm mb-5"
          style={{ fontFamily: SANS }}
        >
          From quote {orDash(quote.quoteNumber)} · {orDash(quote.clientName)}
        </p>

        {/* What will be billed */}
        <div
          className={`rounded-lg border p-4 mb-5 ${
            isInitial ? "bg-[#E8F4F0] border-[#006045]" : "bg-[#F4F4F5] border-[#E4E4E7]"
          }`}
          style={{ fontFamily: SANS }}
        >
          {links === null ? (
            <p className="text-sm text-[#52525C] flex items-center gap-2">
              {linksFailed ? (
                <>
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#71717B]" aria-hidden="true" />
                  Couldn't read this quote's billing history. The server still
                  decides: the first invoice carries the setup fee, later ones do not.
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden="true" />
                  Checking this quote's billing history…
                </>
              )}
            </p>
          ) : (
            <>
              <p
                className={`text-sm mb-3 ${isInitial ? "text-[#006045]" : "text-[#52525C]"}`}
                style={{ fontWeight: 600 }}
              >
                {isInitial
                  ? "This is the first invoice for this quote"
                  : `Invoice ${links.length + 1} for this quote`}
              </p>
              <ul className="text-sm text-[#52525C] space-y-1.5">
                <li className="flex items-center justify-between gap-4">
                  <span>Monthly service lines</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(monthly, currency)}
                  </span>
                </li>
                {isInitial && setupFee > 0 && (
                  <li className="flex items-center justify-between gap-4">
                    <span>One-time setup fee</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(setupFee, currency)}
                    </span>
                  </li>
                )}
                <li className="flex items-center justify-between gap-4 pt-1.5 border-t border-[#ECECEE]">
                  <span style={{ fontWeight: 600 }}>Invoice total</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(invoiceTotal, currency)}
                  </span>
                </li>
              </ul>
              <p className="text-xs text-[#71717B] mt-3">
                {isInitial
                  ? setupFee > 0
                    ? "The setup fee is billed once, on this invoice only. Later months carry the monthly lines alone."
                    : "This quote has no setup fee, so every invoice carries the monthly lines alone."
                  : links.some((l) => l.includesSetupFee)
                    ? "The one-time setup fee was settled on the first invoice and is not repeated."
                    : "This quote has no setup fee, so every invoice carries the monthly lines alone."}{" "}
                No tax is applied; add it on the invoice afterwards if it applies.
              </p>
              {linksFailed && (
                <p className="text-xs text-[#71717B] mt-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                  This history could not be refreshed just now, so it may be out
                  of date. The server decides either way: a period that is
                  already invoiced comes back as the existing invoice rather
                  than a second one.
                </p>
              )}
            </>
          )}
        </div>

        {/* Already-billed periods, so the history is visible while choosing */}
        {links !== null && links.length > 0 && (
          <div className="mb-5">
            <p
              className="text-xs uppercase tracking-wider text-[#71717B] mb-2"
              style={{ fontFamily: SANS, fontWeight: 700 }}
            >
              Already invoiced
            </p>
            <ul
              className="text-sm text-[#52525C] max-h-28 overflow-y-auto border border-[#ECECEE] rounded-lg divide-y divide-[#ECECEE]"
              style={{ fontFamily: SANS }}
            >
              {links.map((link) => (
                <li
                  key={link.invoiceKey || link.invoiceNumber}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span style={{ fontWeight: 600 }}>{orDash(link.invoiceNumber)}</span>
                  <span className="text-[#71717B] text-xs">
                    {formatQuoteDate(link.servicePeriodStart)} –{" "}
                    {formatQuoteDate(link.servicePeriodEnd)}
                    {link.includesSetupFee ? " · incl. setup fee" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          <div>
            <DateField
              label="Service period start"
              value={periodStart}
              onChange={setPeriodStart}
              required
              invalid={!parseISODate(periodStart)}
            />
            <p className="text-xs text-[#71717B] mt-1.5" style={{ fontFamily: SANS }}>
              {periodEnd
                ? `Covers ${formatQuoteDate(periodStart)} – ${formatQuoteDate(periodEnd)}.`
                : "Pick the first day of the month this invoice covers."}
            </p>
            {existingForPeriod && (
              <p
                className="text-xs text-[#C0392F] mt-1.5 flex items-start gap-1.5"
                style={{ fontFamily: SANS }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                {orDash(existingForPeriod.invoiceNumber)} already covers this
                period. Creating it again will return that invoice rather than
                billing a second time.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DateField label="Issue date" value={issueDate} onChange={setIssue} />
            <div>
              <DateField
                label="Due date"
                value={dueDate}
                onChange={(iso) => {
                  setDueTouched(true);
                  setDueDate(iso);
                }}
                invalid={datesOutOfOrder}
              />
              {datesOutOfOrder && (
                <p
                  className="text-xs text-[#C0392F] mt-1.5"
                  style={{ fontFamily: SANS }}
                >
                  The due date is before the issue date.
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="create-invoice-notes"
              className="block text-sm mb-1.5 text-[#52525C]"
              style={{ fontFamily: SANS, fontWeight: 600 }}
            >
              Note (optional)
            </label>
            <textarea
              id="create-invoice-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Appears on the invoice, e.g. a PO number"
              className="w-full px-4 py-2.5 border border-[#E4E4E7] rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#006045] focus:border-transparent text-sm resize-y"
              style={{ fontFamily: SANS }}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 border border-[#E4E4E7] rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: SANS, fontWeight: 600 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 px-4 py-2.5 bg-[#006045] text-white rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ fontFamily: SANS, fontWeight: 700 }}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every amount is rounded at the point of computation, never only at the end. */
const quoteTotal = (quote: Quote): number =>
  displayMonthly(quote);

const sumTotals = (quotes: Quote[]): number =>
  quotes.reduce((sum, q) => roundMoney(sum + quoteTotal(q)), 0);

export default function QuoteManagement() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Lifecycle
  const [statusMenu, setStatusMenu] = useState<{
    quoteId: string;
    anchor: HTMLElement;
  } | null>(null);
  /**
   * Every row with a status change in flight, not just the latest one. A single
   * id could not tell two overlapping moves apart: starting a second one
   * overwrote the first row's marker, and whichever request answered first
   * cleared the marker of a row still waiting — re-enabling its chip mid-flight
   * and letting the same move be sent twice, which the server then answers with
   * a conflict that never really happened.
   */
  const [statusPendingIds, setStatusPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const setStatusPending = (quoteId: string, pending: boolean) => {
    setStatusPendingIds((prev) => {
      if (prev.has(quoteId) === pending) return prev;
      const next = new Set(prev);
      if (pending) next.add(quoteId);
      else next.delete(quoteId);
      return next;
    });
  };
  const [confirmTransition, setConfirmTransition] = useState<{
    quoteId: string;
    to: QuoteStatus;
  } | null>(null);

  // Billing
  const [invoiceLinks, setInvoiceLinks] = useState<Record<string, QuoteInvoiceLink[]>>({});
  /** The opener travels with the target so the dialog can hand focus back. */
  const [invoiceTarget, setInvoiceTarget] = useState<{
    quoteId: string;
    opener: HTMLElement | null;
  } | null>(null);

  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    companyName: "UnitPulse",
    companyAddress: "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
    logoPath: null,
    logoUrl: logoPng,
    companyEmail: "",
    companyPhone: "",
  });

  const filterRef = useRef<HTMLDivElement | null>(null);
  /** Guards against a slow link fetch from an earlier list load landing last. */
  const loadSeq = useRef(0);

  /**
   * Focus a dialog when it mounts, so Escape reaches it and a screen reader
   * lands inside it. Stable by construction: React only calls a callback ref
   * whose identity is unchanged on mount and unmount, so a re-render cannot
   * yank focus back off the button the user just tabbed to.
   */
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    fetchQuotes();
    loadCompanySettings();
  }, []);

  // The status filter is a menu too: Escape and outside click dismiss it.
  useEffect(() => {
    if (!showStatusFilter) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current?.contains(e.target as Node)) return;
      setShowStatusFilter(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showStatusFilter]);

  const loadCompanySettings = async () => {
    try {
      const response = await fetchAPI("/company-settings");
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setCompanySettings({ ...data.settings, logoUrl: data.settings.logoUrl || logoPng });
        }
      }
    } catch (error) {
      console.error("Error loading company settings:", error);
    }
  };

  /**
   * Billing history for the quotes that can have any. Only an accepted quote
   * can be invoiced, and an invoiced quote's status is frozen at accepted, so
   * every other row is known to have none without asking.
   */
  const loadInvoiceLinks = async (list: Quote[], seq: number) => {
    const accepted = list.filter((q) => q.status === "accepted");
    if (accepted.length === 0) {
      setInvoiceLinks({});
      return;
    }
    const entries = await Promise.all(
      accepted.map(async (q): Promise<[string, QuoteInvoiceLink[]] | null> => {
        try {
          const response = await fetchAPI(`/quotes/${q.id}/invoices`);
          if (!response.ok) return null;
          return [q.id, readLinks(await response.json())];
        } catch (error) {
          console.error("Error loading quote invoices:", error);
          return null;
        }
      }),
    );
    // A newer list load has already started; its results are the current ones.
    if (loadSeq.current !== seq) return;
    const next: Record<string, QuoteInvoiceLink[]> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    setInvoiceLinks(next);
  };

  const fetchQuotes = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const response = await fetchAPI("/quotes");
      if (!response.ok) throw new Error("Failed to fetch quotes");
      const data = await response.json();
      if (loadSeq.current !== seq) return;
      const list: Quote[] = data.quotes || [];
      setQuotes(list);
      setLoadError(false);
      loadInvoiceLinks(list, seq);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      if (loadSeq.current !== seq) return;
      setLoadError(true);
      toast.error("Failed to load quotes");
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  };

  const setLinksFor = useCallback((quoteId: string, links: QuoteInvoiceLink[]) => {
    setInvoiceLinks((prev) => ({ ...prev, [quoteId]: links }));
  }, []);

  // Expiry is the server's definition, not the browser's: deriving it from the
  // local date disagreed with the API around midnight outside UTC. Fall back to
  // a local derivation only for a quote the server has not weighed in on.
  const todayISO = toISODate(new Date());
  const displayStatus = (quote: Quote): EffectiveQuoteStatus => {
    if (quote.effectiveStatus) return quote.effectiveStatus;
    const stored = quote.status;
    const lapsed =
      !!quote.validUntil && quote.validUntil < todayISO && (stored === "draft" || stored === "sent");
    return lapsed ? "expired" : stored;
  };

  /**
   * The moves this row may offer. An expired quote offers none — its own date
   * has to be extended in the editor first, and a chip that silently ignored
   * that would be proposing a change the document does not support.
   */
  const transitionsFor = (quote: Quote): QuoteStatus[] =>
    displayStatus(quote) === "expired"
      ? []
      : (ALLOWED_TRANSITIONS[quote.status] ?? []);

  const filteredQuotes = quotes.filter((quote) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      (quote.quoteNumber || "").toLowerCase().includes(query) ||
      (quote.clientName || "").toLowerCase().includes(query);
    // Matched against the status on the chip, not the one in the row: those
    // differ for every lapsed quote, and the chip is what the user is filtering.
    const matchesStatus = statusFilter === "all" || displayStatus(quote) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Metrics, over the filtered set
  const totalValue = sumTotals(filteredQuotes);
  const quoteCount = filteredQuotes.length;
  const avgValue = quoteCount > 0 ? roundMoney(totalValue / quoteCount) : 0;
  const acceptedQuotes = filteredQuotes.filter((q) => displayStatus(q) === "accepted");
  const acceptedValue = sumTotals(acceptedQuotes);
  const awaitingCount = filteredQuotes.filter((q) => displayStatus(q) === "sent").length;

  // Mixed-currency sets have no single meaningful symbol, so fall back to USD.
  const currencies = new Set(filteredQuotes.map((q) => q.currency || "USD"));
  const statsCurrency = currencies.size === 1 ? Array.from(currencies)[0] : "USD";

  const openQuote = (quote: Quote) => {
    navigate(`/quotes/${quote.id}`);
  };

  const deleteQuote = async (id: string) => {
    setDeleteConfirmId(null);
    try {
      const response = await fetchAPI(`/quotes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        // An invoiced quote cannot be deleted — the invoices raised against it
        // would be left describing a document that no longer exists. That is a
        // rule, and the server names it; a generic failure would not.
        toast.error(
          errorMessage(await readJSON(response), "Failed to delete quote"),
        );
        return;
      }
      toast.success("Quote deleted successfully");
      fetchQuotes();
    } catch (error) {
      console.error("Error deleting quote:", error);
      toast.error("Failed to delete quote");
    }
  };

  /* -------------------------------------------------------------------- */
  /* Status transitions                                                   */
  /* -------------------------------------------------------------------- */

  const closeStatusMenu = useCallback(
    (restoreFocus: boolean) => {
      if (restoreFocus) statusMenu?.anchor.focus();
      setStatusMenu(null);
    },
    [statusMenu],
  );

  /**
   * Send the move and wait for it. Deliberately not optimistic: these are
   * contractual statuses, and a chip that says "Accepted" over a request the
   * server refused is worse than a moment of latency.
   */
  const runTransition = async (quote: Quote, to: QuoteStatus) => {
    setConfirmTransition(null);
    setStatusMenu(null);
    setStatusPending(quote.id, true);
    try {
      const response = await fetchAPI(`/quotes/${quote.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, expectedStatus: quote.status }),
      });
      const payload = await readJSON(response);

      // 409: somebody else moved this quote since the list was loaded. The row
      // on screen is stale, so re-read rather than argue with it.
      if (response.status === 409) {
        toast.error(
          errorMessage(payload, "This quote changed since the page was loaded"),
        );
        await fetchQuotes();
        return;
      }

      // Any other refusal is ambiguous about the database: a 5xx from the edge
      // or a proxy can arrive after the transition has already committed, so
      // "it failed" is only ever a claim about the response. Re-read rather
      // than leave a row that may now contradict the record.
      if (!response.ok) {
        toast.error(errorMessage(payload, "Failed to update the quote status"));
        await fetchQuotes();
        return;
      }

      const updated = payload?.quote ?? payload;
      setQuotes((prev) =>
        prev.map((q) => (q.id === quote.id ? applyStatusPayload(q, updated) : q)),
      );
      toast.success(
        `Quote ${orDash(quote.quoteNumber)} is now ${STATUS_LABELS[to].toLowerCase()}`,
      );

      // A quote that just became accepted can be invoiced; read its (empty)
      // billing history so the row's actions are right straight away.
      if (to === "accepted") {
        try {
          const after = await fetchAPI(`/quotes/${quote.id}/invoices`);
          if (after.ok) setLinksFor(quote.id, readLinks(await after.json()));
        } catch (error) {
          console.error("Error loading quote invoices:", error);
        }
      }
    } catch (error) {
      // A thrown request says even less than a failed one — the move may have
      // been committed and only the answer lost. Same treatment.
      console.error("Error updating quote status:", error);
      toast.error("Failed to update the quote status");
      await fetchQuotes();
    } finally {
      setStatusPending(quote.id, false);
    }
  };

  const requestTransition = (quote: Quote, to: QuoteStatus) => {
    if (TRANSITION_WARNINGS[`${quote.status}>${to}`]) {
      setStatusMenu(null);
      setConfirmTransition({ quoteId: quote.id, to });
      return;
    }
    runTransition(quote, to);
  };

  const downloadQuote = async (quote: Quote) => {
    setDownloadingId(quote.id);
    try {
      const convertImageToPNG = async (imgSrc: string) => {
        return new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const maxDisplaySize = 32;
            const resolutionScale = 4;
            let displayWidth = img.width;
            let displayHeight = img.height;
            if (displayWidth > maxDisplaySize || displayHeight > maxDisplaySize) {
              if (displayWidth > displayHeight) {
                displayHeight = (displayHeight / displayWidth) * maxDisplaySize;
                displayWidth = maxDisplaySize;
              } else {
                displayWidth = (displayWidth / displayHeight) * maxDisplaySize;
                displayHeight = maxDisplaySize;
              }
            }
            canvas.width = displayWidth * resolutionScale;
            canvas.height = displayHeight * resolutionScale;
            const ctx = canvas.getContext("2d")!;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve({ dataUrl: canvas.toDataURL("image/png", 1.0), width: displayWidth, height: displayHeight });
          };
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = imgSrc;
        });
      };

      let logoDataUrl = logoPng, logoWidth = 32, logoHeight = 32;
      if (companySettings.logoUrl && companySettings.logoPath) {
        try {
          const response = await fetch(companySettings.logoUrl);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const result = await convertImageToPNG(objectUrl);
          logoDataUrl = result.dataUrl; logoWidth = result.width; logoHeight = result.height;
          URL.revokeObjectURL(objectUrl);
        } catch {
          const result = await convertImageToPNG(logoPng);
          logoDataUrl = result.dataUrl; logoWidth = result.width; logoHeight = result.height;
        }
      } else {
        const result = await convertImageToPNG(logoPng);
        logoDataUrl = result.dataUrl; logoWidth = result.width; logoHeight = result.height;
      }

      const pdf = await generateQuotePDF(quote, companySettings, logoDataUrl, logoWidth, logoHeight);
      pdf.save(`${quote.quoteNumber || "quote"}.pdf`);
    } catch (error) {
      console.error("Error downloading quote:", error);
      toast.error("Failed to download quote");
    } finally {
      setDownloadingId(null);
    }
  };

  /**
   * Explains a chip that says "Expired" while the stored status still says
   * draft or sent. It always does now: `expired` stopped being storable in
   * 20260816000000, so the chip is derived from the date every time.
   */
  const statusNote = (quote: Quote): string | undefined =>
    displayStatus(quote) === "expired"
      ? `Validity lapsed on ${formatQuoteDate(quote.validUntil)}`
      : undefined;

  const menuQuote = statusMenu
    ? quotes.find((q) => q.id === statusMenu.quoteId) ?? null
    : null;
  const confirmQuote = confirmTransition
    ? quotes.find((q) => q.id === confirmTransition.quoteId) ?? null
    : null;
  const invoiceQuote = invoiceTarget
    ? quotes.find((q) => q.id === invoiceTarget.quoteId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Toaster position="top-center" />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "Newsreader, Georgia, serif", fontWeight: 500 }}>
              Quotes
            </h1>
            <p className="text-[#71717B] mt-1 text-sm sm:text-base" style={{ fontFamily: SANS }}>
              Service quotes you have prepared, sent, and closed
            </p>
          </div>
          <button
            onClick={() => navigate("/quotes/new")}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#006045] text-white rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer text-sm"
            style={{ fontFamily: SANS, fontWeight: 600 }}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Quote</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: SANS }}>
                Total Value
              </span>
              <div className="w-8 h-8 bg-[#F4F4F5] rounded-lg flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-[#52525C]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: SANS }}>
              {formatMoney(totalValue, statsCurrency)}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: SANS }}>
              Monthly, across the quotes shown
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: SANS }}>
                Quotes
              </span>
              <div className="w-8 h-8 bg-[#F4F4F5] rounded-lg flex items-center justify-center">
                <Receipt className="w-4 h-4 text-[#52525C]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: SANS }}>
              {quoteCount}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: SANS }}>
              Avg {formatMoney(avgValue, statsCurrency)} each
            </p>
          </div>

          {/* The one affirmative card — emerald marks accepted, nothing else. */}
          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: SANS }}>
                Accepted
              </span>
              <div className="w-8 h-8 bg-[#E8F4F0] rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-[#006045]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#006045]" style={{ fontFamily: SANS }}>
              {formatMoney(acceptedValue, statsCurrency)}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: SANS }}>
              {acceptedQuotes.length} accepted
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: SANS }}>
                Awaiting Reply
              </span>
              <div className="w-8 h-8 bg-[#F4F4F5] rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-[#52525C]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: SANS }}>
              {awaitingCount}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: SANS }}>
              Sent and still within validity
            </p>
          </div>
        </div>

        {/* Search, Filter, Quote List */}
        <div className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden">
          {/* List Header */}
          <div className="px-6 py-4 border-b border-[#E4E4E7] flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by quote number or client name..."
                aria-label="Search quotes"
                className="w-full pl-10 pr-4 py-2 border border-[#E4E4E7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#006045] focus:border-transparent text-sm"
                style={{ fontFamily: SANS }}
              />
            </div>

            <div
              className="relative"
              ref={filterRef}
              onKeyDown={(e) => {
                if (e.key === "Escape" && showStatusFilter) {
                  e.preventDefault();
                  setShowStatusFilter(false);
                }
              }}
            >
              <button
                onClick={() => setShowStatusFilter(!showStatusFilter)}
                aria-expanded={showStatusFilter}
                className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm transition-colors cursor-pointer ${
                  statusFilter !== "all"
                    ? "bg-[#006045] text-white border-[#006045]"
                    : "bg-white border-[#E4E4E7] text-[#71717B] hover:bg-[#FAFAFA]"
                }`}
                style={{ fontFamily: SANS }}
              >
                <Filter className="w-4 h-4" />
                {statusFilter === "all" ? "All Statuses" : STATUS_LABELS[statusFilter]}
              </button>
              {showStatusFilter && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-[#E4E4E7] z-10 max-h-64 overflow-y-auto">
                  <div className="p-1">
                    <button
                      onClick={() => { setStatusFilter("all"); setShowStatusFilter(false); }}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer ${statusFilter === "all" ? "bg-[#E8F4F0] text-[#006045]" : "hover:bg-[#FAFAFA]"}`}
                      style={{ fontFamily: SANS }}
                    >All Statuses</button>
                    {FILTER_STATUSES.map((status) => (
                      <button
                        key={status}
                        onClick={() => { setStatusFilter(status); setShowStatusFilter(false); }}
                        className={`w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer ${statusFilter === status ? "bg-[#E8F4F0] text-[#006045]" : "hover:bg-[#FAFAFA]"}`}
                        style={{ fontFamily: SANS }}
                      >{STATUS_LABELS[status]}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(searchQuery || statusFilter !== "all") && (
              <button
                onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}
                title="Clear search and filter"
                aria-label="Clear search and filter"
                className="p-2 border border-[#E4E4E7] rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#006045]" />
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <AlertCircle className="w-12 h-12 text-[#D4D4D8] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#18181B] mb-1" style={{ fontFamily: SANS }}>Couldn't load quotes</h3>
              <p className="text-sm text-[#71717B] mb-4" style={{ fontFamily: SANS }}>Check your connection and try again</p>
              <button
                onClick={fetchQuotes}
                className="border border-[#E4E4E7] px-5 py-2 rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer text-sm"
                style={{ fontFamily: SANS, fontWeight: 600 }}
              >Try again</button>
            </div>
          ) : quotes.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-12 h-12 text-[#D4D4D8] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#18181B] mb-1" style={{ fontFamily: SANS }}>No quotes yet</h3>
              <p className="text-sm text-[#71717B] mb-4" style={{ fontFamily: SANS }}>Create your first service quote to see it here</p>
              <button
                onClick={() => navigate("/quotes/new")}
                className="bg-[#006045] text-white px-5 py-2 rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer text-sm"
                style={{ fontFamily: SANS, fontWeight: 500 }}
              >Create Quote</button>
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="py-16 text-center">
              <Search className="w-12 h-12 text-[#D4D4D8] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#18181B] mb-1" style={{ fontFamily: SANS }}>No matching quotes</h3>
              <p className="text-sm text-[#71717B]" style={{ fontFamily: SANS }}>Try adjusting your search or filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F4F4F5] text-[#52525C] border-b border-[#E4E4E7]">
                  <tr>
                    {["Quote #", "Client", "Quote Date", "Valid Until", "Status", "Monthly Total", "Actions"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-6 py-3 text-xs font-semibold uppercase tracking-wider ${i >= 5 ? "text-right" : "text-left"}`}
                        style={{ fontFamily: SANS }}
                      >{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map((quote, index) => {
                    const transitions = transitionsFor(quote);
                    const pending = statusPendingIds.has(quote.id);
                    const links = invoiceLinks[quote.id] ?? [];
                    const canInvoice = quote.status === "accepted";
                    return (
                    <tr
                      key={quote.id}
                      onClick={() => openQuote(quote)}
                      aria-busy={pending || undefined}
                      className={`group cursor-pointer hover:bg-[#E8F4F0] transition-colors ${index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}`}
                    >
                      <td className="px-6 py-4 font-medium text-sm" style={{ fontFamily: SANS }}>
                        {/* A real control, so the row is reachable by keyboard too. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); openQuote(quote); }}
                          className="text-left rounded focus:outline-none focus:ring-2 focus:ring-[#006045] cursor-pointer hover:underline"
                          style={{ fontFamily: SANS, fontWeight: 600 }}
                        >{orDash(quote.quoteNumber)}</button>
                      </td>
                      <td className="px-6 py-4 text-sm" style={{ fontFamily: SANS }}>{orDash(quote.clientName)}</td>
                      <td className="px-6 py-4 text-sm text-[#71717B] group-hover:text-[#52525C]" style={{ fontFamily: SANS }}>{formatQuoteDate(quote.quoteDate)}</td>
                      <td className="px-6 py-4 text-sm text-[#71717B] group-hover:text-[#52525C]" style={{ fontFamily: SANS }}>{formatQuoteDate(quote.validUntil)}</td>
                      <td className="px-6 py-4 text-sm">
                        {transitions.length > 0 ? (
                          <StatusChipButton
                            status={displayStatus(quote)}
                            quoteNumber={orDash(quote.quoteNumber)}
                            pending={pending}
                            open={statusMenu?.quoteId === quote.id}
                            onOpen={(anchor) =>
                              setStatusMenu((prev) =>
                                prev?.quoteId === quote.id
                                  ? null
                                  : { quoteId: quote.id, anchor },
                              )
                            }
                          />
                        ) : (
                          <StatusChip status={displayStatus(quote)} note={statusNote(quote)} />
                        )}
                        {canInvoice && links.length > 0 && (
                          <p
                            className="text-xs text-[#71717B] mt-1.5"
                            style={{ fontFamily: SANS }}
                            title={`Invoices from this quote: ${links.map((l) => l.invoiceNumber).join(", ")}`}
                          >
                            {links.length} invoice{links.length === 1 ? "" : "s"}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-sm text-[#006045]" style={{ fontFamily: SANS }}>
                        {formatMoney(quoteTotal(quote), quote.currency || "USD")}
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canInvoice && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setInvoiceTarget({ quoteId: quote.id, opener: e.currentTarget });
                              }}
                              disabled={pending}
                              title="Create invoice"
                              aria-label={`Create an invoice from quote ${orDash(quote.quoteNumber)}`}
                              className="p-2 text-[#71717B] hover:text-[#006045] hover:bg-[#E8F4F0] rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <FilePlus className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadQuote(quote); }}
                            disabled={downloadingId === quote.id}
                            title="Download PDF"
                            aria-label={`Download PDF for quote ${orDash(quote.quoteNumber)}`}
                            className="p-2 text-[#71717B] hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(quote.id); }}
                            title="Delete"
                            aria-label={`Delete quote ${orDash(quote.quoteNumber)}`}
                            className="p-2 text-[#71717B] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Status menu — mounted at the page root, never inside the row. */}
      {statusMenu && menuQuote && transitionsFor(menuQuote).length > 0 && (
        <StatusMenu
          key={statusMenu.quoteId}
          anchor={statusMenu.anchor}
          quoteNumber={orDash(menuQuote.quoteNumber)}
          from={menuQuote.status}
          options={transitionsFor(menuQuote)}
          onSelect={(to) => requestTransition(menuQuote, to)}
          onClose={closeStatusMenu}
        />
      )}

      {/* Transition Confirm Modal */}
      {confirmTransition && confirmQuote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmTransition(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transition-confirm-title"
            tabIndex={-1}
            ref={focusOnMount}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setConfirmTransition(null);
              }
            }}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 focus:outline-none"
          >
            <h2
              id="transition-confirm-title"
              className="text-xl mb-2"
              style={{ fontFamily: SANS, fontWeight: 700 }}
            >
              {transitionLabel(confirmTransition.to)}?
            </h2>
            <p
              className="text-[#71717B] text-sm mb-2"
              style={{ fontFamily: SANS }}
            >
              {TRANSITION_WARNINGS[`${confirmQuote.status}>${confirmTransition.to}`]}
            </p>
            <p
              className="text-[#52525C] text-sm mb-6"
              style={{ fontFamily: SANS }}
            >
              Quote {orDash(confirmQuote.quoteNumber)} · {orDash(confirmQuote.clientName)}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmTransition(null)}
                className="flex-1 px-4 py-2.5 border border-[#E4E4E7] rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                style={{ fontFamily: SANS, fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => runTransition(confirmQuote, confirmTransition.to)}
                className="flex-1 px-4 py-2.5 bg-[#006045] text-white rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer"
                style={{ fontFamily: SANS, fontWeight: 700 }}
              >
                {transitionLabel(confirmTransition.to)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {invoiceQuote && (
        <CreateInvoiceModal
          key={invoiceQuote.id}
          quote={invoiceQuote}
          seedLinks={invoiceLinks[invoiceQuote.id]}
          opener={invoiceTarget?.opener ?? null}
          onLinksChange={setLinksFor}
          onClose={() => setInvoiceTarget(null)}
          onViewInvoices={() => navigate("/")}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirmId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-quote-title"
            tabIndex={-1}
            ref={focusOnMount}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setDeleteConfirmId(null);
              }
            }}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 focus:outline-none"
          >
            <h2
              id="delete-quote-title"
              className="text-xl mb-2"
              style={{ fontFamily: SANS, fontWeight: 700 }}
            >
              Delete Quote
            </h2>
            <p
              className="text-[#71717B] text-sm mb-6"
              style={{ fontFamily: SANS }}
            >
              Are you sure you want to delete this quote? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 border border-[#E4E4E7] rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                style={{ fontFamily: SANS, fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteQuote(deleteConfirmId)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
                style={{ fontFamily: SANS, fontWeight: 700 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
