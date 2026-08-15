/**
 * DateField — a design-system replacement for `<input type="date">`.
 *
 * The native control renders its picker as browser chrome: unthemeable, and
 * different on every OS/browser combination. This is a button trigger plus a
 * month-grid popover built entirely from UnitPulse tokens, so a date field
 * lines up with the text inputs beside it and looks the same everywhere.
 *
 * Dates are handled as strict local-midnight `Date`s. Never `new Date(iso)` —
 * that parses yyyy-mm-dd as UTC midnight and renders as the previous day
 * anywhere west of Greenwich, and it silently normalises overflow so
 * "2026-02-31" becomes March 3. See `parseISODate` below, which is a copy of
 * the one in ../types/quote (that module keeps it private).
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { formatQuoteDate, toISODate } from "../types/quote";

const SANS = "Manrope, sans-serif";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a strict yyyy-mm-dd into a LOCAL date, or null. Mirrors the private
 * `parseISODate` in ../types/quote — same regex, same round-trip rejection of
 * dates the Date constructor would otherwise normalise into a different day.
 */
const parseISODate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const m = ISO_DATE.exec(iso.trim());
  if (!m) return null;
  const [, ys, ms, ds] = m;
  const y = Number(ys),
    mo = Number(ms),
    d = Number(ds);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null;
  }
  return dt;
};

/** Local midnight of a Date, so every comparison is day-to-day. */
const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Day count of a month. Day 0 of the next month is the last day of this one. */
const daysInMonth = (y: number, m: number): number =>
  new Date(y, m + 1, 0).getDate();

const WEEKDAYS = [
  { short: "Su", long: "Sunday" },
  { short: "Mo", long: "Monday" },
  { short: "Tu", long: "Tuesday" },
  { short: "We", long: "Wednesday" },
  { short: "Th", long: "Thursday" },
  { short: "Fr", long: "Friday" },
  { short: "Sa", long: "Saturday" },
];

export interface DateFieldProps {
  label?: string;
  /** ISO "yyyy-mm-dd", or "" when unset. */
  value: string;
  /** Emits "yyyy-mm-dd", or "" when cleared. */
  onChange: (iso: string) => void;
  /** ISO; dates before this are disabled. */
  min?: string;
  /** ISO; dates after this are disabled. */
  max?: string;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  id?: string;
}

export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  required = false,
  invalid = false,
  placeholder = "Select a date",
  id,
}: DateFieldProps): JSX.Element {
  const reactId = useId();
  const triggerId = id ?? `datefield-${reactId}`;
  const headingId = `${triggerId}-month`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  /**
   * Whether the next render should pull DOM focus onto the focused day. Set
   * when opening or arrow-navigating; deliberately NOT set by the month
   * arrows, so a user paging through months keeps focus on the arrow.
   */
  const wantsDayFocus = useRef(false);

  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [align, setAlign] = useState<"left" | "right">("left");

  const selected = parseISODate(value);
  const minDate = parseISODate(min);
  const maxDate = parseISODate(max);
  const today = startOfDay(new Date());
  const todayISO = toISODate(today);

  const [viewYM, setViewYM] = useState(() => {
    const base = selected ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const [focusedISO, setFocusedISO] = useState(() =>
    toISODate(selected ?? today),
  );

  const isOutOfRange = useCallback(
    (d: Date): boolean =>
      Boolean(
        (minDate && d.getTime() < minDate.getTime()) ||
          (maxDate && d.getTime() > maxDate.getTime()),
      ),
    // Compared by value, not identity: a new Date object every render would
    // otherwise rebuild this callback (and the grid) on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minDate?.getTime(), maxDate?.getTime()],
  );

  const clampToRange = useCallback(
    (d: Date): Date => {
      if (minDate && d.getTime() < minDate.getTime()) return startOfDay(minDate);
      if (maxDate && d.getTime() > maxDate.getTime()) return startOfDay(maxDate);
      return d;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minDate?.getTime(), maxDate?.getTime()],
  );

  /* ---------------------------------------------------------------- */
  /* Open / close                                                     */
  /* ---------------------------------------------------------------- */

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openPicker = useCallback(() => {
    const start = clampToRange(startOfDay(selected ?? new Date()));
    setViewYM({ y: start.getFullYear(), m: start.getMonth() });
    setFocusedISO(toISODate(start));
    setPlacement("bottom");
    setAlign("left");
    wantsDayFocus.current = true;
    setOpen(true);
  }, [clampToRange, selected]);

  // Outside click. mousedown rather than click so a drag that starts inside
  // and ends outside does not close the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Move real focus onto the focused day (roving tabindex), but only when the
  // interaction asked for it.
  useEffect(() => {
    if (!open || !wantsDayFocus.current) return;
    wantsDayFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-iso="${focusedISO}"]`)
      ?.focus();
  }, [open, focusedISO]);

  /**
   * Flip above the trigger when the popover would run off the bottom of the
   * viewport, and right-align it when it would run off the right edge. Runs
   * before paint, so the popover never renders in the wrong place first.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;
    const t = trigger.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const needed = p.height + 8;
    const below = window.innerHeight - t.bottom;
    setPlacement(below < needed && t.top > below ? "top" : "bottom");
    setAlign(t.left + p.width > window.innerWidth - 8 ? "right" : "left");
  }, [open]);

  /* ---------------------------------------------------------------- */
  /* Selection                                                        */
  /* ---------------------------------------------------------------- */

  const select = useCallback(
    (iso: string) => {
      onChange(iso);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const moveFocusTo = useCallback(
    (d: Date) => {
      const next = clampToRange(d);
      setFocusedISO(toISODate(next));
      setViewYM({ y: next.getFullYear(), m: next.getMonth() });
      wantsDayFocus.current = true;
    },
    [clampToRange],
  );

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cur = parseISODate(focusedISO);
    if (!cur) return;
    let days = 0;
    let months = 0;
    switch (e.key) {
      case "ArrowLeft":
        days = -1;
        break;
      case "ArrowRight":
        days = 1;
        break;
      case "ArrowUp":
        days = -7;
        break;
      case "ArrowDown":
        days = 7;
        break;
      case "Home":
        days = -cur.getDay();
        break;
      case "End":
        days = 6 - cur.getDay();
        break;
      case "PageUp":
        months = -1;
        break;
      case "PageDown":
        months = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (months) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + months;
      // Clamp the day so Jan 31 + 1 month lands on Feb 28, not March 3.
      const target = new Date(y, m, 1);
      const day = Math.min(
        cur.getDate(),
        daysInMonth(target.getFullYear(), target.getMonth()),
      );
      moveFocusTo(new Date(target.getFullYear(), target.getMonth(), day));
    } else {
      moveFocusTo(
        new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + days),
      );
    }
  };

  /* ---------------------------------------------------------------- */
  /* Grid                                                             */
  /* ---------------------------------------------------------------- */

  // Always 6 rows so the popover height — and therefore its placement — never
  // changes as the user pages through months.
  const cells = useMemo(() => {
    const first = new Date(viewYM.y, viewYM.m, 1);
    const offset = first.getDay();
    return Array.from({ length: 42 }, (_, i) => {
      // Constructed field-by-field rather than by adding milliseconds, which
      // would drift by an hour across a DST boundary.
      const d = new Date(viewYM.y, viewYM.m, 1 - offset + i);
      return {
        date: d,
        iso: toISODate(d),
        inMonth: d.getMonth() === viewYM.m && d.getFullYear() === viewYM.y,
      };
    });
  }, [viewYM.y, viewYM.m]);

  const monthLabel = new Date(viewYM.y, viewYM.m, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  const prevDisabled = Boolean(
    minDate && new Date(viewYM.y, viewYM.m, 0).getTime() < minDate.getTime(),
  );
  const nextDisabled = Boolean(
    maxDate && new Date(viewYM.y, viewYM.m + 1, 1).getTime() > maxDate.getTime(),
  );
  const todayDisabled = isOutOfRange(today);

  const stepMonth = (delta: number) => {
    const target = new Date(viewYM.y, viewYM.m + delta, 1);
    const y = target.getFullYear();
    const m = target.getMonth();
    setViewYM({ y, m });
    // Keep the keyboard cursor inside the visible month, without stealing
    // focus away from the arrow the user is clicking.
    const cur = parseISODate(focusedISO);
    const day = cur ? Math.min(cur.getDate(), daysInMonth(y, m)) : 1;
    setFocusedISO(toISODate(clampToRange(new Date(y, m, day))));
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  const displayText = selected ? formatQuoteDate(value) : "";

  const navBtn =
    "h-8 w-8 inline-flex items-center justify-center rounded-md text-[#52525C] hover:bg-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#006045] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  const footerBtn =
    "px-2 py-1 rounded-md text-sm hover:bg-[#F4F4F5] focus:outline-none focus:ring-2 focus:ring-[#006045] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <div className="relative" ref={rootRef}>
      {label && (
        <label
          htmlFor={triggerId}
          className="block text-sm mb-1.5 text-[#52525C]"
          style={{ fontFamily: SANS, fontWeight: 600 }}
        >
          {label}
          {required && (
            <span className="text-[#D84B4B]" aria-hidden="true">
              {" *"}
            </span>
          )}
        </label>
      )}

      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        className={
          "w-full px-4 py-2.5 border rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#006045] focus:border-transparent " +
          (invalid ? "border-[#D84B4B] " : "border-[#E4E4E7] ") +
          "flex items-center justify-between gap-2 text-left cursor-pointer transition-colors hover:bg-[#FAFAFA]"
        }
        style={{ fontFamily: SANS }}
      >
        <span
          className={displayText ? "truncate" : "truncate text-[#71717B]"}
          style={displayText ? { fontVariantNumeric: "tabular-nums" } : undefined}
        >
          {displayText || placeholder}
        </span>
        <Calendar size={16} className="shrink-0 text-[#71717B]" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label={label ? `${label} — choose a date` : "Choose a date"}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.preventDefault();
              closeAndRestoreFocus();
            }
          }}
          className={
            "absolute z-50 w-[288px] bg-white rounded-xl border border-[#E4E4E7] p-3 " +
            (placement === "bottom" ? "top-full mt-2 " : "bottom-full mb-2 ") +
            (align === "left" ? "left-0" : "right-0")
          }
          style={{
            fontFamily: SANS,
            boxShadow: "0 10px 28px -6px rgba(0,0,0,.14)",
          }}
        >
          {/* Month header */}
          <div className="flex items-center justify-between pb-2 mb-1 border-b border-[#ECECEE]">
            <button
              type="button"
              className={navBtn}
              onClick={() => stepMonth(-1)}
              disabled={prevDisabled}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <div
              id={headingId}
              aria-live="polite"
              className="text-sm text-[#18181B]"
              style={{ fontWeight: 600 }}
            >
              {monthLabel}
            </div>
            <button
              type="button"
              className={navBtn}
              onClick={() => stepMonth(1)}
              disabled={nextDisabled}
              aria-label="Next month"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Day grid */}
          <div
            ref={gridRef}
            role="grid"
            aria-labelledby={headingId}
            onKeyDown={onGridKeyDown}
          >
            <div role="row" className="grid grid-cols-7">
              {WEEKDAYS.map((w) => (
                <div
                  key={w.short}
                  role="columnheader"
                  aria-label={w.long}
                  className="h-8 flex items-center justify-center text-[11px] text-[#71717B]"
                  style={{ fontWeight: 700 }}
                >
                  {w.short}
                </div>
              ))}
            </div>

            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div role="row" key={row} className="grid grid-cols-7">
                {cells.slice(row * 7, row * 7 + 7).map((cell) => {
                  const isSelected = Boolean(selected) && cell.iso === value;
                  const isToday = cell.iso === todayISO;
                  const disabled = isOutOfRange(cell.date);
                  const isFocusTarget = cell.iso === focusedISO;

                  let tone = "text-[#18181B] hover:bg-[#FAFAFA]";
                  if (!cell.inMonth) tone = "text-[#71717B] hover:bg-[#FAFAFA]";
                  if (isToday && !isSelected) {
                    tone =
                      "text-[#006045] border border-[#006045] hover:bg-[#FAFAFA]";
                  }
                  if (isSelected) tone = "bg-[#006045] text-white";
                  if (disabled) {
                    tone = "text-[#71717B] opacity-40 cursor-not-allowed";
                  }

                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      role="gridcell"
                      data-iso={cell.iso}
                      aria-selected={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={formatQuoteDate(cell.iso)}
                      disabled={disabled}
                      tabIndex={isFocusTarget && !disabled ? 0 : -1}
                      onClick={() => select(cell.iso)}
                      onFocus={() => setFocusedISO(cell.iso)}
                      className={
                        "h-9 w-full rounded-md text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#006045] " +
                        tone
                      }
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: isSelected || isToday ? 700 : 500,
                      }}
                    >
                      {cell.date.getDate()}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#ECECEE]">
            <button
              type="button"
              className={`${footerBtn} text-[#006045]`}
              style={{ fontWeight: 600 }}
              disabled={todayDisabled}
              onClick={() => select(todayISO)}
            >
              Today
            </button>
            <button
              type="button"
              className={`${footerBtn} text-[#52525C]`}
              style={{ fontWeight: 500 }}
              onClick={() => select("")}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DateField;
