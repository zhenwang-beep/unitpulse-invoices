import React from "react";
import type { CompanySettings } from "../App";
import {
  type Quote,
  quoteSubtotal,
  monthlyRecurringTotal,
  initialAmountDue,
  lineAmount,
  formatMoney,
  orDash,
  formatQuoteDate,
  APPROVAL_LINE,
  SCOPE_FOOTNOTE,
  AMOUNTS_FOOTNOTE,
  ACCEPTANCE_NOTE,
} from "../types/quote";

/** Letter at 96dpi. The PDF is 612pt wide at the same 48pt margin. */
export const QUOTE_PAGE_W = 816;

const SANS = "Manrope, sans-serif";
const SERIF = "Newsreader, Georgia, serif";

/** UI/Micro label — 10px Bold uppercase, tracked, in text/muted. */
function Eyebrow({
  children,
  className = "",
  tone = "#71717B",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <div
      className={`uppercase ${className}`}
      style={{
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.1em",
        color: tone,
      }}
    >
      {children}
    </div>
  );
}

function SectionHead({ number, title }: { number: string; title: string }) {
  return (
    <div className="mb-4">
      <Eyebrow className="mb-1">{`SECTION ${number}`}</Eyebrow>
      <h2
        style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 20, color: "#18181B" }}
      >
        {title}
      </h2>
    </div>
  );
}

/** Scope / inclusion bullets. The em-dash prefix is the template's idiom. */
function Bullets({ items }: { items: string[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="text-sm" style={{ fontFamily: SANS, color: "#71717B" }}>
        —
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {items.map((b, i) => (
        <li
          key={i}
          className="text-sm flex gap-2"
          style={{ fontFamily: SANS, color: "#52525C", lineHeight: 1.5 }}
        >
          <span aria-hidden="true">—</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2.5 border-b border-[#ECECEE] last:border-b-0">
      <div className="text-sm" style={{ fontFamily: SANS, color: "#71717B" }}>
        {label}
      </div>
      <div
        className="col-span-2 text-sm"
        style={{ fontFamily: SANS, color: "#18181B" }}
      >
        {value}
      </div>
    </div>
  );
}

function SignatureBlock({ heading }: { heading: string }) {
  return (
    <div>
      <Eyebrow className="mb-4">{heading}</Eyebrow>
      {["Signature", "Printed name", "Title", "Date"].map((label) => (
        <div key={label} className="mb-5">
          <div className="h-8 border-b border-[#71717B]" />
          <div
            className="mt-1 text-xs"
            style={{ fontFamily: SANS, color: "#71717B" }}
          >
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

interface QuotePreviewProps {
  quote: Quote;
  companySettings: CompanySettings;
}

export const QuotePreview = React.forwardRef<HTMLDivElement, QuotePreviewProps>(
  ({ quote, companySettings }, ref) => {
    const subtotal = quoteSubtotal(quote.lineItems);
    const monthly = monthlyRecurringTotal(quote.lineItems);
    const dueAtSigning = initialAmountDue(quote.lineItems, quote.setupFee);
    const hasSetupFee = (Number(quote.setupFee) || 0) > 0;

    return (
      <div
        ref={ref}
        className="quote-pdf-container bg-white shadow-lg"
        style={{
          width: QUOTE_PAGE_W,
          minHeight: 1056,
          padding: 48,
          fontFamily: SANS,
          color: "#18181B",
          backgroundColor: "#FFFFFF",
        }}
      >
        {/* ---------- Header ---------- */}
        <div className="flex flex-row justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            {companySettings.logoUrl && (
              <div style={{ width: 36, height: 36 }}>
                <img
                  src={companySettings.logoUrl}
                  alt={companySettings.companyName}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              </div>
            )}
            <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18 }}>
              {companySettings.companyName}
            </span>
          </div>
          <div className="text-right">
            <Eyebrow>Service Quote</Eyebrow>
            <div
              className="mt-1"
              style={{ fontFamily: SANS, fontWeight: 700, fontSize: 14 }}
            >
              {orDash(quote.quoteNumber)}
            </div>
          </div>
        </div>

        {/* ---------- The one dark band (surface/brief). Never add a second. ---------- */}
        <div
          className="rounded-2xl px-8 py-7 mb-8"
          style={{ backgroundColor: "#18181B", color: "#FFFFFF" }}
        >
          <Eyebrow tone="#A1A1AA">Prepared for</Eyebrow>
          <div
            className="mt-2"
            style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 24 }}
          >
            {orDash(quote.clientName)}
          </div>
          {quote.preparedForAddress && (
            <div
              className="mt-1 text-sm"
              style={{ fontFamily: SANS, color: "#D4D4D8" }}
            >
              {quote.preparedForAddress}
            </div>
          )}
          {quote.serviceLine && (
            <div
              className="mt-1 text-sm"
              style={{ fontFamily: SANS, color: "#D4D4D8" }}
            >
              {quote.serviceLine}
            </div>
          )}

          <div className="grid grid-cols-3 gap-6 mt-6 pt-6 border-t border-white/15">
            <div>
              <Eyebrow tone="#A1A1AA">Monthly investment</Eyebrow>
              <div
                className="mt-1.5"
                style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 22 }}
              >
                {formatMoney(monthly, quote.currency)}
              </div>
            </div>
            <div>
              <Eyebrow tone="#A1A1AA">Initial term</Eyebrow>
              <div
                className="mt-1.5"
                style={{ fontFamily: SANS, fontWeight: 600, fontSize: 15 }}
              >
                {/* Rule 3: only null/undefined is "unknown". A truthiness test
                    here would print 0 as an em-dash, swapping the two facts. */}
                {quote.initialTermMonths === null || quote.initialTermMonths === undefined
                  ? "—"
                  : `${quote.initialTermMonths} months`}
              </div>
            </div>
            <div>
              <Eyebrow tone="#A1A1AA">Service start</Eyebrow>
              <div
                className="mt-1.5"
                style={{ fontFamily: SANS, fontWeight: 600, fontSize: 15 }}
              >
                {formatQuoteDate(quote.serviceStartDate)}
              </div>
            </div>
          </div>
        </div>

        {/* ---------- Issued by / Issued to ---------- */}
        <div className="grid grid-cols-2 gap-8 mb-4">
          <div>
            <Eyebrow className="mb-2">Issued by</Eyebrow>
            <div className="text-sm" style={{ fontFamily: SANS }}>
              <div style={{ fontWeight: 700 }}>{companySettings.companyName}</div>
              <div style={{ color: "#52525C" }}>{orDash(quote.issuerName)}</div>
              {quote.issuerEmail && (
                <div style={{ color: "#71717B" }}>{quote.issuerEmail}</div>
              )}
              {quote.issuerPhone && (
                <div style={{ color: "#71717B" }}>{quote.issuerPhone}</div>
              )}
            </div>
          </div>
          <div>
            <Eyebrow className="mb-2">Issued to</Eyebrow>
            <div className="text-sm" style={{ fontFamily: SANS }}>
              <div style={{ fontWeight: 700 }}>{orDash(quote.clientName)}</div>
              <div style={{ color: "#52525C" }}>
                {[quote.clientContactName, quote.clientContactTitle]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </div>
              {quote.clientEmail && (
                <div style={{ color: "#71717B" }}>{quote.clientEmail}</div>
              )}
              {quote.clientPhone && (
                <div style={{ color: "#71717B" }}>{quote.clientPhone}</div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8 pt-3 border-t border-[#E4E4E7]">
          <div className="text-sm" style={{ fontFamily: SANS, color: "#71717B" }}>
            Quote date{" "}
            <span style={{ color: "#18181B", fontWeight: 600 }}>
              {formatQuoteDate(quote.quoteDate)}
            </span>
          </div>
          <div className="text-sm" style={{ fontFamily: SANS, color: "#71717B" }}>
            Valid until{" "}
            <span style={{ color: "#18181B", fontWeight: 600 }}>
              {formatQuoteDate(quote.validUntil)}
            </span>
          </div>
        </div>

        {/* ---------- 01 Investment summary ---------- */}
        <SectionHead number="01" title="Investment summary" />

        <div className="border border-[#E4E4E7] rounded-xl overflow-hidden mb-3">
          <div
            className="grid grid-cols-12 gap-4 px-4 py-2.5"
            style={{ backgroundColor: "#F4F4F5" }}
          >
            {(
              [
                ["Service", "col-span-6 text-left"],
                ["Qty", "col-span-2 text-center"],
                ["Unit price", "col-span-2 text-right"],
                ["Monthly", "col-span-2 text-right"],
              ] as const
            ).map(([label, cls]) => (
              <div key={label} className={cls}>
                <Eyebrow tone="#52525C">{label}</Eyebrow>
              </div>
            ))}
          </div>

          {quote.lineItems.length === 0 ? (
            <div
              className="px-4 py-4 text-sm"
              style={{ fontFamily: SANS, color: "#71717B" }}
            >
              No services added yet.
            </div>
          ) : (
            quote.lineItems.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-4 px-4 py-3 border-t border-[#ECECEE]"
              >
                <div className="col-span-6">
                  <div
                    className="text-sm"
                    style={{ fontFamily: SANS, fontWeight: 700 }}
                  >
                    {orDash(item.serviceName)}
                  </div>
                  {item.description && (
                    <div
                      className="text-xs mt-0.5"
                      style={{ fontFamily: SANS, color: "#71717B", lineHeight: 1.5 }}
                    >
                      {item.description}
                    </div>
                  )}
                </div>
                <div
                  className="col-span-2 text-center text-sm"
                  style={{ fontFamily: SANS, fontVariantNumeric: "tabular-nums" }}
                >
                  {item.quantity}
                </div>
                <div
                  className="col-span-2 text-right text-sm"
                  style={{ fontFamily: SANS, fontVariantNumeric: "tabular-nums" }}
                >
                  {formatMoney(item.unitPrice, quote.currency)}
                </div>
                <div
                  className="col-span-2 text-right text-sm"
                  style={{
                    fontFamily: SANS,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatMoney(lineAmount(item), quote.currency)}
                </div>
              </div>
            ))
          )}

          <div className="border-t border-[#E4E4E7]">
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-sm" style={{ fontFamily: SANS, color: "#71717B" }}>
                Subtotal
              </span>
              <span
                className="text-sm"
                style={{ fontFamily: SANS, fontVariantNumeric: "tabular-nums" }}
              >
                {formatMoney(subtotal, quote.currency)}
              </span>
            </div>
            <div className="flex justify-between px-4 py-2.5 border-t border-[#ECECEE]">
              <span className="text-sm" style={{ fontFamily: SANS, color: "#71717B" }}>
                One-time setup fee
              </span>
              <span
                className="text-sm"
                style={{ fontFamily: SANS, fontVariantNumeric: "tabular-nums" }}
              >
                {formatMoney(quote.setupFee, quote.currency)}
              </span>
            </div>
            {/* The one emerald fill — the affirmative.
                This is the RECURRING monthly charge. A one-time setup fee is
                shown above and again as "due at signing" below; adding it in
                here would overstate what the client pays every month. */}
            <div
              className="flex justify-between items-center px-4 py-3"
              style={{ backgroundColor: "#006045", color: "#FFFFFF" }}
            >
              <Eyebrow tone="#FFFFFF">Total due monthly</Eyebrow>
              <span
                style={{
                  fontFamily: SERIF,
                  fontWeight: 500,
                  fontSize: 22,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMoney(monthly, quote.currency)}
              </span>
            </div>
            {hasSetupFee && (
              <div className="flex justify-between px-4 py-2.5 border-t border-[#E4E4E7]">
                <span
                  className="text-sm"
                  style={{ fontFamily: SANS, color: "#52525C", fontWeight: 600 }}
                >
                  Due at signing (first month + setup)
                </span>
                <span
                  className="text-sm"
                  style={{
                    fontFamily: SANS,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatMoney(dueAtSigning, quote.currency)}
                </span>
              </div>
            )}
          </div>
        </div>

        <p
          className="text-xs mb-8"
          style={{ fontFamily: SANS, color: "#71717B", lineHeight: 1.6 }}
        >
          {AMOUNTS_FOOTNOTE}
        </p>

        {/* ---------- 02 Scope of services ---------- */}
        <SectionHead number="02" title="Scope of services" />
        <div className="border-t border-[#E4E4E7] mb-4">
          {quote.scopeGroups.map((g) => (
            <div
              key={g.id}
              className="grid grid-cols-3 gap-6 py-4 border-b border-[#ECECEE]"
            >
              <div>
                <div
                  className="text-sm"
                  style={{ fontFamily: SANS, fontWeight: 700 }}
                >
                  {orDash(g.title)}
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{ fontFamily: SANS, color: "#71717B" }}
                >
                  {g.category}
                </div>
              </div>
              <div className="col-span-2">
                <Bullets items={g.bullets} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm mb-8" style={{ fontFamily: SANS, lineHeight: 1.6 }}>
          <span style={{ fontWeight: 700, color: "#18181B" }}>{APPROVAL_LINE}</span>{" "}
          <span style={{ color: "#52525C" }}>{SCOPE_FOOTNOTE}</span>
        </p>

        {/* ---------- 03 Terms & conditions ---------- */}
        <SectionHead number="03" title="Terms & conditions" />
        <div className="border-t border-[#E4E4E7] mb-8">
          <TermRow
            label="Service start date"
            value={formatQuoteDate(quote.serviceStartDate)}
          />
          <TermRow
            label="Initial term"
            value={
              quote.initialTermMonths === null || quote.initialTermMonths === undefined
                ? "—"
                : `${quote.initialTermMonths} months from the service start date`
            }
          />
          <TermRow label="Renewal" value={orDash(quote.renewalTerms)} />
          <TermRow label="Cancellation" value={orDash(quote.cancellationTerms)} />
          <TermRow label="Billing cadence" value={orDash(quote.billingCadence)} />
          <TermRow label="Payment terms" value={orDash(quote.paymentTerms)} />
          <TermRow label="Price changes" value={orDash(quote.priceChangeTerms)} />
          <TermRow label="Quote validity" value={orDash(quote.quoteValidityTerms)} />
        </div>

        {/* ---------- 04 Assumptions & exclusions ---------- */}
        <SectionHead number="04" title="Assumptions & exclusions" />
        <div className="grid grid-cols-2 gap-8 pt-4 border-t border-[#E4E4E7] mb-4">
          <div>
            {/* text/accent on "Included" only — the template says so explicitly. */}
            <Eyebrow className="mb-2" tone="#006045">
              Included
            </Eyebrow>
            <Bullets items={quote.included} />
          </div>
          <div>
            <Eyebrow className="mb-2">Not included</Eyebrow>
            <Bullets items={quote.excluded} />
          </div>
        </div>
        {quote.assumptionsNote && (
          <p
            className="text-sm mb-8"
            style={{ fontFamily: SANS, color: "#52525C", lineHeight: 1.6 }}
          >
            {quote.assumptionsNote}
          </p>
        )}

        {/* ---------- 05 Acceptance ---------- */}
        <SectionHead number="05" title="Acceptance" />
        <p
          className="text-sm mb-6"
          style={{ fontFamily: SANS, color: "#52525C", lineHeight: 1.6 }}
        >
          {ACCEPTANCE_NOTE}
        </p>
        <div className="grid grid-cols-2 gap-10 mb-8">
          <SignatureBlock heading="For the client" />
          <SignatureBlock heading={`For ${companySettings.companyName}`} />
        </div>

        {quote.notes && (
          <>
            <div className="h-px bg-[#E4E4E7] mb-4" />
            <p
              className="text-sm italic"
              style={{ fontFamily: SANS, color: "#71717B", lineHeight: 1.6 }}
            >
              {quote.notes}
            </p>
          </>
        )}
      </div>
    );
  },
);

QuotePreview.displayName = "QuotePreview";
