import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { generateQuotePDF } from "../quote-pdf-generator";
import logoPng from "../../assets/logo.svg";
import type { CompanySettings } from "../App";
import { Navbar } from "../components/Navbar";
import { fetchAPI } from "../utils/api";
import type { Quote, QuoteStatus } from "../types/quote";
import {
  QUOTE_STATUSES,
  formatMoney,
  formatQuoteDate,
  orDash,
  monthlyRecurringTotal,
  roundMoney,
  toISODate,
} from "../types/quote";

/**
 * Status chips carry their label as text — colour is never the only signal.
 * Class strings are written out in full so Tailwind's scanner sees them.
 */
const STATUS_LABELS: Record<QuoteStatus, string> = {
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
const STATUS_CHIP: Record<QuoteStatus, string> = {
  draft: "bg-[#F4F4F5] border-[#E4E4E7] text-[#52525C]",
  sent: "bg-white border-[#52525C] text-[#18181B]",
  accepted: "bg-[#E8F4F0] border-[#006045] text-[#006045]",
  declined: "bg-[#18181B] border-[#18181B] text-white",
  expired: "bg-white border-[#E4E4E7] text-[#71717B]",
};

type StatusFilter = "all" | QuoteStatus;

/** Colour is the second signal; the label is the first. */
function StatusChip({ status, note }: { status: QuoteStatus; note?: string }) {
  return (
    <span
      className={`inline-flex items-center border px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_CHIP[status]}`}
      style={{ fontFamily: "Manrope, sans-serif" }}
      title={note}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Every amount is rounded at the point of computation, never only at the end. */
const quoteTotal = (quote: Quote): number =>
  monthlyRecurringTotal(quote.lineItems || []);

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
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    companyName: "UnitPulse",
    companyAddress: "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
    logoPath: null,
    logoUrl: logoPng,
    companyEmail: "",
    companyPhone: "",
  });

  useEffect(() => {
    fetchQuotes();
    loadCompanySettings();
  }, []);

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

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const response = await fetchAPI("/quotes");
      if (!response.ok) throw new Error("Failed to fetch quotes");
      const data = await response.json();
      setQuotes(data.quotes || []);
      setLoadError(false);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      setLoadError(true);
      toast.error("Failed to load quotes");
    } finally {
      setLoading(false);
    }
  };

  // Expiry is the server's definition, not the browser's: deriving it from the
  // local date disagreed with the API around midnight outside UTC. Fall back to
  // a local derivation only for a quote the server has not weighed in on.
  const todayISO = toISODate(new Date());
  const displayStatus = (quote: Quote): QuoteStatus => {
    if (quote.effectiveStatus) return quote.effectiveStatus;
    const stored = quote.status;
    const lapsed =
      !!quote.validUntil && quote.validUntil < todayISO && (stored === "draft" || stored === "sent");
    return lapsed ? "expired" : stored;
  };

  const filteredQuotes = quotes.filter((quote) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      (quote.quoteNumber || "").toLowerCase().includes(query) ||
      (quote.clientName || "").toLowerCase().includes(query);
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
      if (!response.ok) throw new Error("Failed to delete quote");
      toast.success("Quote deleted successfully");
      fetchQuotes();
    } catch (error) {
      console.error("Error deleting quote:", error);
      toast.error("Failed to delete quote");
    }
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

      const pdf = generateQuotePDF(quote, companySettings, logoDataUrl, logoWidth, logoHeight);
      pdf.save(`${quote.quoteNumber || "quote"}.pdf`);
    } catch (error) {
      console.error("Error downloading quote:", error);
      toast.error("Failed to download quote");
    } finally {
      setDownloadingId(null);
    }
  };

  /** Explains a chip that says "Expired" while the stored status still says otherwise. */
  const statusNote = (quote: Quote): string | undefined =>
    displayStatus(quote) === "expired" && quote.status !== "expired"
      ? `Validity lapsed on ${formatQuoteDate(quote.validUntil)}`
      : undefined;

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
            <p className="text-[#71717B] mt-1 text-sm sm:text-base" style={{ fontFamily: "Manrope, sans-serif" }}>
              Service quotes you have prepared, sent, and closed
            </p>
          </div>
          <button
            onClick={() => navigate("/quotes/new")}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#006045] text-white rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer text-sm"
            style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
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
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Total Value
              </span>
              <div className="w-8 h-8 bg-[#F4F4F5] rounded-lg flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-[#52525C]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {formatMoney(totalValue, statsCurrency)}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>
              Monthly, across the quotes shown
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Quotes
              </span>
              <div className="w-8 h-8 bg-[#F4F4F5] rounded-lg flex items-center justify-center">
                <Receipt className="w-4 h-4 text-[#52525C]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {quoteCount}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>
              Avg {formatMoney(avgValue, statsCurrency)} each
            </p>
          </div>

          {/* The one affirmative card — emerald marks accepted, nothing else. */}
          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Accepted
              </span>
              <div className="w-8 h-8 bg-[#E8F4F0] rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-[#006045]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#006045]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {formatMoney(acceptedValue, statsCurrency)}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>
              {acceptedQuotes.length} accepted
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71717B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Awaiting Reply
              </span>
              <div className="w-8 h-8 bg-[#F4F4F5] rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-[#52525C]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {awaitingCount}
            </p>
            <p className="text-xs text-[#71717B] mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>
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
                style={{ fontFamily: "Manrope, sans-serif" }}
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setShowStatusFilter(!showStatusFilter)}
                aria-expanded={showStatusFilter}
                className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm transition-colors cursor-pointer ${
                  statusFilter !== "all"
                    ? "bg-[#006045] text-white border-[#006045]"
                    : "bg-white border-[#E4E4E7] text-[#71717B] hover:bg-[#FAFAFA]"
                }`}
                style={{ fontFamily: "Manrope, sans-serif" }}
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
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >All Statuses</button>
                    {QUOTE_STATUSES.map((status) => (
                      <button
                        key={status}
                        onClick={() => { setStatusFilter(status); setShowStatusFilter(false); }}
                        className={`w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer ${statusFilter === status ? "bg-[#E8F4F0] text-[#006045]" : "hover:bg-[#FAFAFA]"}`}
                        style={{ fontFamily: "Manrope, sans-serif" }}
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
              <h3 className="text-base font-semibold text-[#18181B] mb-1" style={{ fontFamily: "Manrope, sans-serif" }}>Couldn't load quotes</h3>
              <p className="text-sm text-[#71717B] mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>Check your connection and try again</p>
              <button
                onClick={fetchQuotes}
                className="border border-[#E4E4E7] px-5 py-2 rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer text-sm"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
              >Try again</button>
            </div>
          ) : quotes.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-12 h-12 text-[#D4D4D8] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#18181B] mb-1" style={{ fontFamily: "Manrope, sans-serif" }}>No quotes yet</h3>
              <p className="text-sm text-[#71717B] mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>Create your first service quote to see it here</p>
              <button
                onClick={() => navigate("/quotes/new")}
                className="bg-[#006045] text-white px-5 py-2 rounded-lg hover:bg-[#004F3B] transition-colors cursor-pointer text-sm"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 500 }}
              >Create Quote</button>
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="py-16 text-center">
              <Search className="w-12 h-12 text-[#D4D4D8] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#18181B] mb-1" style={{ fontFamily: "Manrope, sans-serif" }}>No matching quotes</h3>
              <p className="text-sm text-[#71717B]" style={{ fontFamily: "Manrope, sans-serif" }}>Try adjusting your search or filter</p>
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
                        style={{ fontFamily: "Manrope, sans-serif" }}
                      >{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map((quote, index) => (
                    <tr
                      key={quote.id}
                      onClick={() => openQuote(quote)}
                      className={`group cursor-pointer hover:bg-[#E8F4F0] transition-colors ${index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}`}
                    >
                      <td className="px-6 py-4 font-medium text-sm" style={{ fontFamily: "Manrope, sans-serif" }}>
                        {/* A real control, so the row is reachable by keyboard too. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); openQuote(quote); }}
                          className="text-left rounded focus:outline-none focus:ring-2 focus:ring-[#006045] cursor-pointer hover:underline"
                          style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
                        >{orDash(quote.quoteNumber)}</button>
                      </td>
                      <td className="px-6 py-4 text-sm" style={{ fontFamily: "Manrope, sans-serif" }}>{orDash(quote.clientName)}</td>
                      <td className="px-6 py-4 text-sm text-[#71717B] group-hover:text-[#52525C]" style={{ fontFamily: "Manrope, sans-serif" }}>{formatQuoteDate(quote.quoteDate)}</td>
                      <td className="px-6 py-4 text-sm text-[#71717B] group-hover:text-[#52525C]" style={{ fontFamily: "Manrope, sans-serif" }}>{formatQuoteDate(quote.validUntil)}</td>
                      <td className="px-6 py-4 text-sm">
                        <StatusChip status={displayStatus(quote)} note={statusNote(quote)} />
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-sm text-[#006045]" style={{ fontFamily: "Manrope, sans-serif" }}>
                        {formatMoney(quoteTotal(quote), quote.currency || "USD")}
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2
              className="text-xl mb-2"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}
            >
              Delete Quote
            </h2>
            <p
              className="text-[#71717B] text-sm mb-6"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Are you sure you want to delete this quote? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 border border-[#E4E4E7] rounded-lg hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteQuote(deleteConfirmId)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}
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
