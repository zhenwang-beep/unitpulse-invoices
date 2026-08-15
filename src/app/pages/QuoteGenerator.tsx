import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Eye,
  Download,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Navbar } from "../components/Navbar";
import { QuotePreview, QUOTE_PAGE_W } from "../components/QuotePreview";
import { fetchAPI } from "../utils/api";
import { generateQuotePDF } from "../quote-pdf-generator";
import { resolveLogoBitmap } from "../utils/logoToPng";
import logoPng from "../../assets/logo.svg";
import type { CompanySettings } from "../App";
import {
  type Quote,
  type QuoteLineItem,
  type ScopeGroup,
  QUOTE_STATUSES,
  createEmptyQuote,
  DEFAULT_QUOTE_DEFAULTS,
  quoteSubtotal,
  monthlyRecurringTotal,
  formatMoney,
  newId,
  addDays,
} from "../types/quote";

const SANS = "Manrope, sans-serif";
const SERIF = "Newsreader, Georgia, serif";

/* ------------------------------------------------------------------ */
/* Small form primitives — match the invoice form's idiom              */
/* ------------------------------------------------------------------ */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="block text-sm mb-1.5 text-[#52525C]"
      style={{ fontFamily: SANS, fontWeight: 600 }}
    >
      {children}
    </label>
  );
}

const inputCls =
  "w-full px-4 py-2.5 border border-[#E4E4E7] rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#006045] focus:border-transparent";

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  min,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  min?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        min={min}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        style={{ fontFamily: SANS }}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        style={{ fontFamily: SANS, resize: "vertical" }}
      />
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
  defaultOpen = false,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#E4E4E7] rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#FAFAFA] transition-colors cursor-pointer text-left"
      >
        <span>
          {eyebrow && (
            <span
              className="block uppercase text-[10px] tracking-[0.1em] text-[#71717B] mb-0.5"
              style={{ fontFamily: SANS, fontWeight: 700 }}
            >
              {eyebrow}
            </span>
          )}
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 15 }}>
            {title}
          </span>
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-[#71717B] shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[#71717B] shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-[#ECECEE]">
          {children}
        </div>
      )}
    </div>
  );
}

/** Editable "— bullet" list. */
function BulletEditor({
  items,
  onChange,
  addLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((b, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={b}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className={inputCls}
            style={{ fontFamily: SANS }}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            title="Remove"
            aria-label={`Remove item ${i + 1}`}
            className="p-2.5 rounded-lg border border-[#E4E4E7] text-[#71717B] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="flex items-center gap-1.5 text-sm text-[#006045] hover:underline cursor-pointer"
        style={{ fontFamily: SANS, fontWeight: 600 }}
      >
        <Plus className="w-4 h-4" /> {addLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function QuoteGenerator() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = Boolean(id);

  const [quote, setQuote] = useState<Quote>(() => createEmptyQuote());
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    companyName: "UnitPulse",
    companyAddress:
      "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
    logoPath: null,
    logoUrl: logoPng,
    companyEmail: "",
    companyPhone: "",
  });
  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(id ?? null);
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  // Cleared by the first edit; see the settings loader below.
  const pristineRef = useRef(true);
  // Download renders current form state, so it must not be reachable while that
  // state differs from what was saved — otherwise the PDF a client receives
  // says something the stored quote does not.
  const [dirty, setDirty] = useState(false);

  // Bumped on every edit. The save handler snapshots it, and only adopts the
  // server's response if nothing changed while the request was in flight —
  // otherwise a slow save silently discards whatever was typed meanwhile and,
  // worse, marks the result clean.
  const revisionRef = useRef(0);

  const markDirty = useCallback(() => {
    pristineRef.current = false;
    revisionRef.current += 1;
    setDirty(true);
  }, []);

  const patch = useCallback((fields: Partial<Quote>) => {
    markDirty();
    setQuote((q) => ({ ...q, ...fields }));
  }, [markDirty]);

  /* ---------- load settings (and quote defaults) ---------- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchAPI("/company-settings");
        if (!res.ok) return;
        const data = await res.json();
        if (data.settings) {
          setCompanySettings({
            ...data.settings,
            logoUrl: data.settings.logoUrl || logoPng,
          });
        }
        // Defaults seed a NEW quote only, and only while it is still pristine.
        // Settings arrive asynchronously; on a slow connection the response
        // could otherwise land after the user had started typing and replace
        // the whole draft, silently discarding their edits.
        if (!isEditMode && data.settings?.quoteDefaults && pristineRef.current) {
          setQuote(
            createEmptyQuote({
              ...DEFAULT_QUOTE_DEFAULTS,
              ...data.settings.quoteDefaults,
            }),
          );
        }
      } catch (e) {
        console.error("Error loading company settings:", e);
      }
    })();
  }, [isEditMode]);

  /* ---------- load existing quote ---------- */
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetchAPI(`/quotes/${id}`);
        if (!res.ok) {
          toast.error("Could not load that quote");
          navigate("/quotes");
          return;
        }
        const data = await res.json();
        setQuote(data.quote);
        setSavedId(data.quote.id);
      } catch (e) {
        console.error("Error loading quote:", e);
        toast.error("Could not load that quote");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  const subtotal = quoteSubtotal(quote.lineItems);
  const total = monthlyRecurringTotal(quote.lineItems);

  /* ---------- line items ---------- */
  const updateLineItem = (
    itemId: string,
    fields: Partial<QuoteLineItem>,
  ) => {
    markDirty();
    setQuote((q) => ({
      ...q,
      lineItems: q.lineItems.map((it) =>
        it.id === itemId ? { ...it, ...fields } : it,
      ),
    }));
  };

  const addLineItem = () => {
    markDirty();
    setQuote((q) => ({
      ...q,
      lineItems: [
        ...q.lineItems,
        {
          id: newId(),
          position: q.lineItems.length,
          serviceName: "",
          description: "",
          quantity: 1,
          unitPrice: 0,
        },
      ],
    }));
  };

  const removeLineItem = (itemId: string) => {
    markDirty();
    setQuote((q) => ({
      ...q,
      lineItems: q.lineItems
        .filter((it) => it.id !== itemId)
        .map((it, i) => ({ ...it, position: i })),
    }));
  };

  /* ---------- scope groups ---------- */
  const updateGroup = (gid: string, fields: Partial<ScopeGroup>) => {
    markDirty();
    setQuote((q) => ({
      ...q,
      scopeGroups: q.scopeGroups.map((g) =>
        g.id === gid ? { ...g, ...fields } : g,
      ),
    }));
  };

  const addGroup = () => {
    markDirty();
    setQuote((q) => ({
      ...q,
      scopeGroups: [
        ...q.scopeGroups,
        { id: newId(), title: "", category: "", bullets: [""] },
      ],
    }));
  };

  const removeGroup = (gid: string) => {
    markDirty();
    setQuote((q) => ({
      ...q,
      scopeGroups: q.scopeGroups.filter((g) => g.id !== gid),
    }));
  };

  /* ---------- save ---------- */
  const save = async () => {
    if (!quote.clientName.trim()) {
      toast.error("Add a client name before saving");
      return;
    }
    if (quote.validUntil < quote.quoteDate) {
      toast.error("“Valid until” cannot be before the quote date");
      return;
    }
    setSaving(true);
    const revisionAtSend = revisionRef.current;
    try {
      const res = await fetchAPI(
        savedId ? `/quotes/${savedId}` : "/quotes",
        {
          method: savedId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quote }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to save quote");
        return;
      }
      setSavedId(data.quote.id);
      if (revisionRef.current === revisionAtSend) {
        setQuote(data.quote);
        setDirty(false);
      } else {
        // Edited mid-save: keep what is on screen and stay dirty, but take the
        // server-assigned identifiers so the next save updates rather than
        // creating a second quote.
        setQuote((q) => ({
          ...q,
          id: data.quote.id,
          quoteNumber: data.quote.quoteNumber || q.quoteNumber,
        }));
      }
      toast.success(savedId ? "Quote updated" : "Quote saved");
      if (!savedId) navigate(`/quotes/${data.quote.id}`, { replace: true });
    } catch (e) {
      console.error("Error saving quote:", e);
      toast.error("Failed to save quote");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- pdf ---------- */
  const downloadPDF = async () => {
    try {
      const { dataUrl, width, height } = await resolveLogoBitmap(companySettings);
      const pdf = generateQuotePDF(
        quote,
        companySettings,
        dataUrl,
        width,
        height,
      );
      pdf.save(`Quote-${quote.quoteNumber}.pdf`);
    } catch (e) {
      console.error("Error generating quote PDF:", e);
      toast.error("Failed to generate PDF");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Navbar />
        <div className="text-center py-24">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#006045]" />
        </div>
      </div>
    );
  }

  /* ---------------- the form ---------------- */
  const form = (
    <div className="space-y-4">
      <Section title="Quote details" eyebrow="Header" defaultOpen>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Quote number</Label>
            <div
              className="w-full px-4 py-2.5 border border-[#E4E4E7] rounded-lg bg-[#F4F4F5] text-[#52525C]"
              style={{ fontFamily: SANS }}
              aria-label="Quote number"
            >
              {quote.quoteNumber || "Assigned on save"}
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={quote.status}
              onChange={(e) => patch({ status: e.target.value as Quote["status"] })}
              className={inputCls}
              style={{ fontFamily: SANS }}
            >
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Quote date"
            type="date"
            value={quote.quoteDate}
            onChange={(v) =>
              patch({
                quoteDate: v,
                // keep the validity window intact when the quote date moves,
                // so the CHECK (valid_until >= quote_date) can't be violated
                validUntil: v && quote.validUntil < v ? addDays(v, 30) : quote.validUntil,
              })
            }
          />
          <Field
            label="Valid until"
            type="date"
            value={quote.validUntil}
            min={quote.quoteDate}
            onChange={(v) => patch({ validUntil: v })}
          />
          <Field
            label="Service start date"
            type="date"
            value={quote.serviceStartDate}
            onChange={(v) => patch({ serviceStartDate: v })}
          />
          <Field
            label="Initial term (months)"
            type="number"
            min="1"
            value={quote.initialTermMonths ?? ""}
            onChange={(v) =>
              patch({ initialTermMonths: v === "" ? null : Math.max(1, Number(v)) })
            }
          />
        </div>
        <Field
          label="Service line"
          value={quote.serviceLine}
          onChange={(v) => patch({ serviceLine: v })}
          placeholder="GoAiden by UnitPulse · AI marketing & content engagement"
        />
      </Section>

      <Section title="Prepared for" eyebrow="Client" defaultOpen>
        <Field
          label="Client / management company"
          value={quote.clientName}
          onChange={(v) => patch({ clientName: v })}
        />
        <Field
          label="Property address"
          value={quote.preparedForAddress}
          onChange={(v) => patch({ preparedForAddress: v })}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Contact name"
            value={quote.clientContactName}
            onChange={(v) => patch({ clientContactName: v })}
          />
          <Field
            label="Contact title"
            value={quote.clientContactTitle}
            onChange={(v) => patch({ clientContactTitle: v })}
          />
          <Field
            label="Contact email"
            type="email"
            value={quote.clientEmail}
            onChange={(v) => patch({ clientEmail: v })}
          />
          <Field
            label="Contact phone"
            value={quote.clientPhone}
            onChange={(v) => patch({ clientPhone: v })}
          />
        </div>
      </Section>

      <Section title="Issued by" eyebrow="Account executive">
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Name"
            value={quote.issuerName}
            onChange={(v) => patch({ issuerName: v })}
          />
          <Field
            label="Email"
            type="email"
            value={quote.issuerEmail}
            onChange={(v) => patch({ issuerEmail: v })}
          />
        </div>
        <Field
          label="Phone"
          value={quote.issuerPhone}
          onChange={(v) => patch({ issuerPhone: v })}
        />
      </Section>

      <Section title="Investment summary" eyebrow="Section 01" defaultOpen>
        <div className="space-y-3">
          {quote.lineItems.map((item, i) => (
            <div
              key={item.id}
              className="border border-[#E4E4E7] rounded-lg p-3 space-y-3"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-3">
                  <Field
                    label="Service"
                    value={item.serviceName}
                    onChange={(v) => updateLineItem(item.id, { serviceName: v })}
                  />
                  <TextArea
                    label="Description"
                    rows={2}
                    value={item.description}
                    onChange={(v) => updateLineItem(item.id, { description: v })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLineItem(item.id)}
                  title="Remove service"
                  aria-label={`Remove service ${i + 1}`}
                  className="mt-7 p-2.5 rounded-lg border border-[#E4E4E7] text-[#71717B] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field
                  label="Qty"
                  type="number"
                  min="0"
                  value={item.quantity}
                  onChange={(v) =>
                    updateLineItem(item.id, { quantity: Math.max(0, Number(v) || 0) })
                  }
                />
                <Field
                  label="Unit price"
                  type="number"
                  min="0"
                  value={item.unitPrice}
                  onChange={(v) =>
                    updateLineItem(item.id, { unitPrice: Math.max(0, Number(v) || 0) })
                  }
                />
                <div>
                  <Label>Monthly</Label>
                  <div
                    className="px-4 py-2.5 rounded-lg bg-[#F4F4F5] text-[#18181B]"
                    style={{ fontFamily: SANS, fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatMoney(
                      (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
                      quote.currency,
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addLineItem}
            className="w-full py-2.5 border border-[#E4E4E7] rounded-lg text-[#006045] hover:bg-[#E8F4F0] transition-colors cursor-pointer flex items-center justify-center gap-2"
            style={{ fontFamily: SANS, fontWeight: 600 }}
          >
            <Plus className="w-4 h-4" /> Add service
          </button>

          <Field
            label="One-time setup fee"
            type="number"
            min="0"
            value={quote.setupFee}
            onChange={(v) => patch({ setupFee: Math.max(0, Number(v) || 0) })}
          />

          <div className="flex justify-between items-center pt-3 border-t border-[#E4E4E7]">
            <span className="text-sm text-[#71717B]" style={{ fontFamily: SANS }}>
              Subtotal {formatMoney(subtotal, quote.currency)} · Total due monthly
            </span>
            <span
              style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 20, color: "#006045" }}
            >
              {formatMoney(total, quote.currency)}
            </span>
          </div>
        </div>
      </Section>

      <Section title="Scope of services" eyebrow="Section 02">
        {quote.scopeGroups.map((g, i) => (
          <div key={g.id} className="border border-[#E4E4E7] rounded-lg p-3 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-2 gap-3">
                <Field
                  label="Title"
                  value={g.title}
                  onChange={(v) => updateGroup(g.id, { title: v })}
                />
                <Field
                  label="Category"
                  value={g.category}
                  onChange={(v) => updateGroup(g.id, { category: v })}
                />
              </div>
              <button
                type="button"
                onClick={() => removeGroup(g.id)}
                title="Remove group"
                aria-label={`Remove scope group ${i + 1}`}
                className="mt-7 p-2.5 rounded-lg border border-[#E4E4E7] text-[#71717B] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <BulletEditor
              items={g.bullets}
              onChange={(next) => updateGroup(g.id, { bullets: next })}
              addLabel="Add bullet"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addGroup}
          className="w-full py-2.5 border border-[#E4E4E7] rounded-lg text-[#006045] hover:bg-[#E8F4F0] transition-colors cursor-pointer flex items-center justify-center gap-2"
          style={{ fontFamily: SANS, fontWeight: 600 }}
        >
          <Plus className="w-4 h-4" /> Add scope group
        </button>
      </Section>

      <Section title="Terms & conditions" eyebrow="Section 03">
        <TextArea
          label="Renewal"
          rows={2}
          value={quote.renewalTerms}
          onChange={(v) => patch({ renewalTerms: v })}
        />
        <TextArea
          label="Cancellation"
          rows={2}
          value={quote.cancellationTerms}
          onChange={(v) => patch({ cancellationTerms: v })}
        />
        <TextArea
          label="Billing cadence"
          rows={2}
          value={quote.billingCadence}
          onChange={(v) => patch({ billingCadence: v })}
        />
        <TextArea
          label="Payment terms"
          rows={2}
          value={quote.paymentTerms}
          onChange={(v) => patch({ paymentTerms: v })}
        />
        <TextArea
          label="Price changes"
          rows={2}
          value={quote.priceChangeTerms}
          onChange={(v) => patch({ priceChangeTerms: v })}
        />
        <TextArea
          label="Quote validity"
          rows={2}
          value={quote.quoteValidityTerms}
          onChange={(v) => patch({ quoteValidityTerms: v })}
        />
      </Section>

      <Section title="Assumptions & exclusions" eyebrow="Section 04">
        <div>
          <Label>Included</Label>
          <BulletEditor
            items={quote.included}
            onChange={(next) => patch({ included: next })}
            addLabel="Add included item"
          />
        </div>
        <div>
          <Label>Not included</Label>
          <BulletEditor
            items={quote.excluded}
            onChange={(next) => patch({ excluded: next })}
            addLabel="Add excluded item"
          />
        </div>
        <TextArea
          label="Assumptions note"
          rows={4}
          value={quote.assumptionsNote}
          onChange={(v) => patch({ assumptionsNote: v })}
        />
      </Section>

      <Section title="Internal notes" eyebrow="Optional">
        <TextArea
          label="Notes shown at the foot of the quote"
          rows={3}
          value={quote.notes}
          onChange={(v) => patch({ notes: v })}
        />
      </Section>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-[#FAFAFA]">
      <Toaster position="top-center" />
      <Navbar />

      {/* ---------------- desktop: form | preview ---------------- */}
      <div className="hidden lg:grid grid-cols-[minmax(0,520px)_1fr] flex-1 overflow-hidden">
        <div className="overflow-y-auto border-r border-[#E4E4E7] bg-[#FAFAFA]">
          <div className="p-8">
            <h1
              className="text-3xl mb-6"
              style={{ fontFamily: SERIF, fontWeight: 500 }}
            >
              {isEditMode ? "Edit Quote" : "New Quote"}
            </h1>
            {form}
          </div>
        </div>

        <div className="bg-[#F4F4F5] overflow-y-auto">
          <div className="p-8">
            <ScaledPreview quote={quote} companySettings={companySettings} />
            <div className="sticky bottom-0 bg-[#F4F4F5] pt-4 -mx-8 px-8 pb-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={downloadPDF}
                  disabled={!savedId || dirty}
                  title={
                    !savedId
                      ? "Save first to download"
                      : dirty
                        ? "Save your changes first — the PDF renders the saved quote"
                        : "Download PDF"
                  }
                  className={`px-6 py-3 rounded-lg border transition-colors ${
                    savedId && !dirty
                      ? "border-[#E4E4E7] text-[#52525C] hover:bg-white cursor-pointer"
                      : "border-gray-200 text-gray-300 cursor-not-allowed"
                  }`}
                  style={{ fontFamily: SANS, fontWeight: 600 }}
                >
                  Download
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => navigate("/quotes")}
                  className="px-6 py-3 border border-[#E4E4E7] rounded-lg text-[#52525C] hover:bg-white transition-colors cursor-pointer"
                  style={{ fontFamily: SANS, fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-12 py-3 bg-[#006045] text-white rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer disabled:opacity-60"
                  style={{ fontFamily: SANS, fontWeight: 600 }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- mobile ---------------- */}
      <div className="lg:hidden flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="p-5">
            <h1
              className="text-3xl mb-5"
              style={{ fontFamily: SERIF, fontWeight: 500 }}
            >
              {isEditMode ? "Edit Quote" : "New Quote"}
            </h1>
            {form}
          </div>
        </div>
        <div className="bg-white border-t border-[#E4E4E7] px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => navigate("/quotes")}
            title="Cancel"
            aria-label="Cancel"
            className="p-2.5 rounded-lg border border-[#E4E4E7] text-[#71717B] hover:bg-[#F4F4F5] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowMobilePreview(true)}
            title="Preview quote"
            aria-label="Preview quote"
            className="p-2.5 rounded-lg border border-[#E4E4E7] text-[#71717B] hover:bg-[#F4F4F5] transition-colors cursor-pointer"
          >
            <Eye className="w-5 h-5" />
          </button>
          <button
            onClick={savedId && !dirty ? downloadPDF : undefined}
            disabled={!savedId || dirty}
            title={savedId ? "Download PDF" : "Save first to download"}
            aria-label="Download PDF"
            className={`p-2.5 rounded-lg border transition-colors ${
              savedId && !dirty
                ? "border-[#E4E4E7] text-[#71717B] hover:bg-[#F4F4F5] cursor-pointer"
                : "border-gray-200 text-gray-300 cursor-not-allowed"
            }`}
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2.5 bg-[#006045] text-white rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer disabled:opacity-60"
            style={{ fontFamily: SANS, fontWeight: 700 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {showMobilePreview && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-[#E4E4E7]">
            <span style={{ fontFamily: SANS, fontWeight: 700 }}>Quote Preview</span>
            <button
              onClick={() => setShowMobilePreview(false)}
              aria-label="Close preview"
              className="p-2 rounded-lg text-[#71717B] hover:bg-[#F4F4F5] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-[#F4F4F5] p-4">
            <ScaledPreview quote={quote} companySettings={companySettings} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Scales the fixed-width letter document down to whatever the panel allows. */
function ScaledPreview({
  quote,
  companySettings,
}: {
  quote: Quote;
  companySettings: CompanySettings;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(1056);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / QUOTE_PAGE_W));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // The document grows with its content, so its height has to be measured
  // rather than assumed — a fixed letter height would clip the later sections.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const ro = new ResizeObserver(() => setHeight(doc.offsetHeight));
    ro.observe(doc);
    setHeight(doc.offsetHeight);
    return () => ro.disconnect();
  });

  // `justify-center` cannot centre this: the child is a fixed 816px, so when the
  // panel is narrower flexbox centres the UNSCALED box and half of it hangs off
  // the left edge — scaling from top-left then leaves it there. Instead the
  // middle element is sized to the SCALED result and centred with margin auto,
  // and the transform happens inside it.
  return (
    <div ref={wrapRef} className="w-full">
      <div
        style={{
          width: Math.floor(QUOTE_PAGE_W * scale),
          height: Math.ceil(height * scale),
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: QUOTE_PAGE_W,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
          }}
        >
          <QuotePreview ref={docRef} quote={quote} companySettings={companySettings} />
        </div>
      </div>
    </div>
  );
}
