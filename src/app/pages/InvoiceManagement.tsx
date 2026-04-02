import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  FileText,
  Download,
  Trash2,
  Edit,
  Search,
  Filter,
  Plus,
  X,
  TrendingUp,
  DollarSign,
  Receipt,
  Users,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { generateInvoicePDF } from "../pdf-generator";
import logoPng from "../../assets/logo.svg";
import type { InvoiceData, CompanySettings } from "../App";
import { Navbar } from "../components/Navbar";
import { fetchAPI } from "../utils/api";

interface SavedInvoice extends InvoiceData {
  id: string;
  subtotal: number;
  tax: number;
  total: number;
  createdAt: string;
  createdByEmail?: string;
  updatedAt?: string;
}

type TimeWindow = "all" | "this_week" | "this_month" | "last_month" | "this_year";

const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  all: "All Time",
  this_week: "This Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_year: "This Year",
};

function getWindowBounds(window: TimeWindow): { start: Date | null; end: Date | null } {
  const now = new Date();
  if (window === "all") return { start: null, end: null };

  if (window === "this_week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return { start, end: now };
  }
  if (window === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end: now };
  }
  if (window === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { start, end };
  }
  if (window === "this_year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { start, end: now };
  }
  return { start: null, end: null };
}

function filterByWindow(invoices: SavedInvoice[], window: TimeWindow): SavedInvoice[] {
  const { start, end } = getWindowBounds(window);
  if (!start) return invoices;
  return invoices.filter((inv) => {
    const date = new Date(inv.createdAt || inv.issueDate);
    return date >= start! && date <= end!;
  });
}

export default function InvoiceManagement() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<SavedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [showClientFilter, setShowClientFilter] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    companyName: "UnitPulse",
    companyAddress: "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
    logoPath: null,
    logoUrl: logoPng,
    companyEmail: "",
    companyPhone: "",
  });

  useEffect(() => {
    fetchInvoices();
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

  const fetchInvoices = async () => {
    try {
      const response = await fetchAPI("/invoices");
      if (!response.ok) throw new Error("Failed to fetch invoices");
      const data = await response.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  // Invoices filtered by time window (for metrics + list)
  const windowInvoices = filterByWindow(invoices, timeWindow);

  // Further filtered by search + client (for list only)
  const filteredInvoices = windowInvoices.filter((inv) => {
    const matchesSearch =
      !searchQuery.trim() ||
      inv.invoiceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.clientName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = selectedClient === "all" || inv.clientName === selectedClient;
    return matchesSearch && matchesClient;
  });

  // Metrics
  const totalValue = windowInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
  const invoiceCount = windowInvoices.length;
  const avgValue = invoiceCount > 0 ? totalValue / invoiceCount : 0;

  // This week value (always computed regardless of window, for a separate stat)
  const thisWeekValue = filterByWindow(invoices, "this_week").reduce(
    (s, inv) => s + (inv.total || 0),
    0
  );
  const thisMonthValue = filterByWindow(invoices, "this_month").reduce(
    (s, inv) => s + (inv.total || 0),
    0
  );

  // Client breakdown within window
  const clientBreakdown = (() => {
    const map: Record<string, number> = {};
    windowInvoices.forEach((inv) => {
      const name = inv.clientName || "No Client";
      map[name] = (map[name] || 0) + (inv.total || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  })();

  const getUniqueClients = () => {
    const clients = new Set(invoices.map((inv) => inv.clientName).filter(Boolean));
    return Array.from(clients).sort();
  };

  const deleteInvoice = async (id: string) => {
    if (!confirm("Are you sure you want to delete this invoice?")) return;
    try {
      const response = await fetchAPI(`/invoices/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete invoice");
      toast.success("Invoice deleted successfully");
      fetchInvoices();
    } catch (error) {
      console.error("Error deleting invoice:", error);
      toast.error("Failed to delete invoice");
    }
  };

  const editInvoice = (invoice: SavedInvoice) => {
    navigate("/new", { state: { invoice } });
  };

  const downloadInvoice = async (invoice: SavedInvoice) => {
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

      const pdf = generateInvoicePDF(invoice, invoice.subtotal, invoice.tax, invoice.total, logoDataUrl, logoWidth, logoHeight, companySettings);
      pdf.save(`${invoice.invoiceId}.pdf`);
      toast.success("Invoice downloaded successfully!");
    } catch (error) {
      console.error("Error downloading invoice:", error);
      toast.error("Failed to download invoice");
    }
  };

  const formatCurrency = (val: number) =>
    val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(2)}`;

  return (
    <div className="min-h-screen bg-[#FCF9F8]">
      <Toaster position="top-center" />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: "Manrope, sans-serif" }}>
              Invoices
            </h1>
            <p className="text-[#6B6B6B] mt-1 text-sm sm:text-base" style={{ fontFamily: "Inter, sans-serif" }}>
              Overview of your invoicing activity
            </p>
          </div>
          <button
            onClick={() => navigate("/new")}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#4A5D23] text-white rounded-lg hover:bg-[#3A4A1B] transition-colors cursor-pointer"
            style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Invoice</span>
            <span className="sm:hidden text-sm">New</span>
          </button>
        </div>

        {/* Time Window Filter */}
        <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          {(Object.keys(TIME_WINDOW_LABELS) as TimeWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => setTimeWindow(w)}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                timeWindow === w
                  ? "bg-[#1A1A1A] text-white"
                  : "bg-white border border-[#E0E0E0] text-[#6B6B6B] hover:bg-[#F5F5F5]"
              }`}
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              {TIME_WINDOW_LABELS[w]}
            </button>
          ))}
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-[#E0E0E0] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Total Value
              </span>
              <div className="w-8 h-8 bg-[#F5F7EE] rounded-lg flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-[#4A5D23]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {formatCurrency(totalValue)}
            </p>
            <p className="text-xs text-[#6B6B6B] mt-1" style={{ fontFamily: "Inter, sans-serif" }}>
              {TIME_WINDOW_LABELS[timeWindow]}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E0E0E0] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Invoices
              </span>
              <div className="w-8 h-8 bg-[#F5F7EE] rounded-lg flex items-center justify-center">
                <Receipt className="w-4 h-4 text-[#4A5D23]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {invoiceCount}
            </p>
            <p className="text-xs text-[#6B6B6B] mt-1" style={{ fontFamily: "Inter, sans-serif" }}>
              Avg {formatCurrency(avgValue)} each
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E0E0E0] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                This Month
              </span>
              <div className="w-8 h-8 bg-[#F5F7EE] rounded-lg flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-[#4A5D23]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {formatCurrency(thisMonthValue)}
            </p>
            <p className="text-xs text-[#6B6B6B] mt-1" style={{ fontFamily: "Inter, sans-serif" }}>
              This week: {formatCurrency(thisWeekValue)}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#E0E0E0] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]" style={{ fontFamily: "Manrope, sans-serif" }}>
                Clients
              </span>
              <div className="w-8 h-8 bg-[#F5F7EE] rounded-lg flex items-center justify-center">
                <Users className="w-4 h-4 text-[#4A5D23]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Manrope, sans-serif" }}>
              {clientBreakdown.length}
            </p>
            <p className="text-xs text-[#6B6B6B] mt-1" style={{ fontFamily: "Inter, sans-serif" }}>
              Active this period
            </p>
          </div>
        </div>

        {/* Client Breakdown */}
        {clientBreakdown.length > 0 && (
          <div className="bg-white rounded-xl border border-[#E0E0E0] p-5 mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6B6B6B] mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>
              Value by Client
            </h2>
            <div className="space-y-3">
              {clientBreakdown.map(([client, value]) => {
                const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
                return (
                  <div key={client}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-[#1A1A1A]" style={{ fontFamily: "Inter, sans-serif" }}>
                        {client}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-[#1A1A1A]" style={{ fontFamily: "Inter, sans-serif" }}>
                          {formatCurrency(value)}
                        </span>
                        <span className="text-xs text-[#6B6B6B] w-10 text-right" style={{ fontFamily: "Inter, sans-serif" }}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-[#F0F0F0] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#4A5D23] rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search, Filter, Invoice List */}
        <div className="bg-white rounded-xl border border-[#E0E0E0] overflow-hidden">
          {/* List Header */}
          <div className="px-6 py-4 border-b border-[#E0E0E0] flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B6B6B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by invoice ID or client name..."
                className="w-full pl-10 pr-4 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent text-sm"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setShowClientFilter(!showClientFilter)}
                className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm transition-colors cursor-pointer ${
                  selectedClient !== "all"
                    ? "bg-[#4A5D23] text-white border-[#4A5D23]"
                    : "bg-white border-[#E0E0E0] text-[#6B6B6B] hover:bg-[#F5F5F5]"
                }`}
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                <Filter className="w-4 h-4" />
                {selectedClient === "all" ? "All Clients" : selectedClient}
              </button>
              {showClientFilter && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-[#E0E0E0] z-10 max-h-64 overflow-y-auto">
                  <div className="p-1">
                    <button
                      onClick={() => { setSelectedClient("all"); setShowClientFilter(false); }}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer ${selectedClient === "all" ? "bg-[#F5F7EE] text-[#4A5D23]" : "hover:bg-[#F5F5F5]"}`}
                      style={{ fontFamily: "Inter, sans-serif" }}
                    >All Clients</button>
                    {getUniqueClients().map((client) => (
                      <button
                        key={client}
                        onClick={() => { setSelectedClient(client); setShowClientFilter(false); }}
                        className={`w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer ${selectedClient === client ? "bg-[#F5F7EE] text-[#4A5D23]" : "hover:bg-[#F5F5F5]"}`}
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >{client}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(searchQuery || selectedClient !== "all") && (
              <button
                onClick={() => { setSearchQuery(""); setSelectedClient("all"); }}
                className="p-2 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#4A5D23]" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-12 h-12 text-[#D0D0D0] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#1A1A1A] mb-1" style={{ fontFamily: "Manrope, sans-serif" }}>No invoices yet</h3>
              <p className="text-sm text-[#6B6B6B] mb-4" style={{ fontFamily: "Inter, sans-serif" }}>Create your first invoice to see it here</p>
              <button
                onClick={() => navigate("/new")}
                className="bg-[#4A5D23] text-white px-5 py-2 rounded-lg hover:bg-[#3A4A1B] transition-colors cursor-pointer text-sm"
                style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
              >Create Invoice</button>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="py-16 text-center">
              <Search className="w-12 h-12 text-[#D0D0D0] mx-auto mb-3" />
              <h3 className="text-base font-semibold text-[#1A1A1A] mb-1" style={{ fontFamily: "Manrope, sans-serif" }}>No matching invoices</h3>
              <p className="text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>Try adjusting your search or filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-black text-white">
                  <tr>
                    {["Invoice ID", "Client", "Issue Date", "Due Date", "Created By", "Total", "Actions"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-6 py-3 text-xs font-semibold uppercase tracking-wider ${i >= 5 ? "text-right" : "text-left"}`}
                        style={{ fontFamily: "Manrope, sans-serif" }}
                      >{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice, index) => (
                    <tr key={invoice.id} className={index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}>
                      <td className="px-6 py-4 font-medium text-sm" style={{ fontFamily: "Inter, sans-serif" }}>{invoice.invoiceId}</td>
                      <td className="px-6 py-4 text-sm" style={{ fontFamily: "Inter, sans-serif" }}>{invoice.clientName || "—"}</td>
                      <td className="px-6 py-4 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>{invoice.issueDate || "—"}</td>
                      <td className="px-6 py-4 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>{invoice.dueDate || "—"}</td>
                      <td className="px-6 py-4 text-sm" style={{ fontFamily: "Inter, sans-serif" }}>
                        <div className="text-[#1A1A1A] text-xs truncate max-w-[140px]">{invoice.createdByEmail || "—"}</div>
                        <div className="text-xs text-[#6B6B6B] mt-0.5">{invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : "—"}</div>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-sm text-[#4A5D23]" style={{ fontFamily: "Inter, sans-serif" }}>
                        ${invoice.total?.toFixed(2) || "0.00"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => editInvoice(invoice)} className="p-2 text-[#6B6B6B] hover:text-[#4A5D23] hover:bg-[#F5F7EE] rounded transition-colors cursor-pointer" title="Edit"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => downloadInvoice(invoice)} className="p-2 text-[#6B6B6B] hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer" title="Download"><Download className="w-4 h-4" /></button>
                          <button onClick={() => deleteInvoice(invoice.id)} className="p-2 text-[#6B6B6B] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
    </div>
  );
}
