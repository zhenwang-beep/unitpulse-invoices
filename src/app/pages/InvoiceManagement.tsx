import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  FileText,
  Download,
  Trash2,
  Edit,
  ArrowLeft,
  Search,
  Filter,
  Plus,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { generateInvoicePDF } from "../pdf-generator";
import logoPng from "../../assets/logo.svg";
import type { InvoiceData, CompanySettings } from "../App";
import { UserProfileMenu } from "../components/UserProfileMenu";
import { fetchAPI } from "../utils/api";

interface SavedInvoice extends InvoiceData {
  id: string;
  subtotal: number;
  tax: number;
  total: number;
  createdAt: string;
  updatedAt?: string;
}

export default function InvoiceManagement() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<SavedInvoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<SavedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [showClientFilter, setShowClientFilter] = useState(false);
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

  useEffect(() => {
    filterInvoices();
  }, [searchQuery, selectedClient, invoices]);

  const loadCompanySettings = async () => {
    try {
      const response = await fetchAPI("/company-settings");

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setCompanySettings({
            ...data.settings,
            logoUrl: data.settings.logoUrl || logoPng,
          });
        }
      }
    } catch (error) {
      console.error("Error loading company settings:", error);
    }
  };

  const fetchInvoices = async () => {
    try {
      const response = await fetchAPI("/invoices");

      if (!response.ok) {
        throw new Error("Failed to fetch invoices");
      }

      const data = await response.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  const filterInvoices = () => {
    let filtered = [...invoices];

    // Filter by search query (invoice ID or client name)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (inv) =>
          inv.invoiceId.toLowerCase().includes(query) ||
          inv.clientName.toLowerCase().includes(query)
      );
    }

    // Filter by client
    if (selectedClient !== "all") {
      filtered = filtered.filter((inv) => inv.clientName === selectedClient);
    }

    setFilteredInvoices(filtered);
  };

  const getUniqueClients = () => {
    const clients = new Set(invoices.map((inv) => inv.clientName).filter(Boolean));
    return Array.from(clients).sort();
  };

  const deleteInvoice = async (id: string) => {
    if (!confirm("Are you sure you want to delete this invoice?")) {
      return;
    }

    try {
      const response = await fetchAPI(`/invoices/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete invoice");
      }

      toast.success("Invoice deleted successfully");
      fetchInvoices();
    } catch (error) {
      console.error("Error deleting invoice:", error);
      toast.error("Failed to delete invoice");
    }
  };

  const editInvoice = (invoice: SavedInvoice) => {
    // Navigate to generator with invoice data in state
    navigate("/", { state: { invoice } });
  };

  const createNewInvoice = () => {
    navigate("/");
  };

  const downloadInvoice = async (invoice: SavedInvoice) => {
    try {
      // Convert logo to PNG data URL
      const convertImageToPNG = async (
        imgSrc: string
      ): Promise<{
        dataUrl: string;
        width: number;
        height: number;
      }> => {
        return new Promise((resolve, reject) => {
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

            const canvasWidth = displayWidth * resolutionScale;
            const canvasHeight = displayHeight * resolutionScale;

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Could not get canvas context"));
              return;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

            resolve({
              dataUrl: canvas.toDataURL("image/png", 1.0),
              width: displayWidth,
              height: displayHeight,
            });
          };

          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = imgSrc;
        });
      };

      let logoDataUrl = logoPng;
      let logoWidth = 32;
      let logoHeight = 32;

      if (companySettings.logoUrl && companySettings.logoPath) {
        try {
          const response = await fetch(companySettings.logoUrl);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const result = await convertImageToPNG(objectUrl);
          logoDataUrl = result.dataUrl;
          logoWidth = result.width;
          logoHeight = result.height;
          URL.revokeObjectURL(objectUrl);
        } catch (error) {
          console.error("Error loading custom logo:", error);
          const result = await convertImageToPNG(logoPng);
          logoDataUrl = result.dataUrl;
          logoWidth = result.width;
          logoHeight = result.height;
        }
      } else {
        const result = await convertImageToPNG(logoPng);
        logoDataUrl = result.dataUrl;
        logoWidth = result.width;
        logoHeight = result.height;
      }

      const pdf = generateInvoicePDF(
        invoice,
        invoice.subtotal,
        invoice.tax,
        invoice.total,
        logoDataUrl,
        logoWidth,
        logoHeight,
        companySettings
      );
      pdf.save(`${invoice.invoiceId}.pdf`);
      toast.success("Invoice downloaded successfully!");
    } catch (error) {
      console.error("Error downloading invoice:", error);
      toast.error("Failed to download invoice");
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Toaster position="top-center" />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-[#6B6B6B] hover:text-black mb-4 transition-colors cursor-pointer"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Invoice Generator
          </button>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1
                className="text-4xl font-bold mb-2"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Invoice Management
              </h1>
              <p
                className="text-[#6B6B6B]"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                View, search, and manage all your saved invoices
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={createNewInvoice}
                className="flex items-center gap-2 px-6 py-3 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
              >
                <Plus className="w-5 h-5" />
                New Invoice
              </button>
              <UserProfileMenu />
            </div>
          </div>

          {/* Search and Filter Bar */}
          <div className="flex items-center gap-4 mt-6">
            {/* Search Input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B6B6B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by invoice ID or client name..."
                className="w-full pl-11 pr-4 py-3 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>

            {/* Client Filter */}
            <div className="relative">
              <button
                onClick={() => setShowClientFilter(!showClientFilter)}
                className={`flex items-center gap-2 px-4 py-3 border rounded-lg transition-colors cursor-pointer ${
                  selectedClient !== "all"
                    ? "bg-[#22C55E] text-white border-[#22C55E]"
                    : "bg-white border-[#E0E0E0] hover:bg-[#F5F5F5]"
                }`}
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                <Filter className="w-5 h-5" />
                {selectedClient === "all" ? "All Clients" : selectedClient}
              </button>

              {showClientFilter && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-[#E0E0E0] z-10 max-h-80 overflow-y-auto">
                  <div className="p-2">
                    <button
                      onClick={() => {
                        setSelectedClient("all");
                        setShowClientFilter(false);
                      }}
                      className={`w-full text-left px-4 py-2 rounded transition-colors cursor-pointer ${
                        selectedClient === "all"
                          ? "bg-[#F0FDF4] text-[#22C55E]"
                          : "hover:bg-[#F5F5F5]"
                      }`}
                      style={{ fontFamily: "Inter, sans-serif" }}
                    >
                      All Clients
                    </button>
                    {getUniqueClients().map((client) => (
                      <button
                        key={client}
                        onClick={() => {
                          setSelectedClient(client);
                          setShowClientFilter(false);
                        }}
                        className={`w-full text-left px-4 py-2 rounded transition-colors cursor-pointer ${
                          selectedClient === client
                            ? "bg-[#F0FDF4] text-[#22C55E]"
                            : "hover:bg-[#F5F5F5]"
                        }`}
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {client}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Clear Filters Button */}
            {(searchQuery || selectedClient !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedClient("all");
                }}
                className="p-3 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-colors cursor-pointer"
                title="Clear filters"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Results Count */}
          {(searchQuery || selectedClient !== "all") && (
            <p
              className="mt-4 text-sm text-[#6B6B6B]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Showing {filteredInvoices.length} of {invoices.length} invoices
            </p>
          )}
        </div>

        {/* Invoice List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#22C55E]"></div>
          </div>
        ) : invoices.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 text-center">
            <FileText className="w-16 h-16 text-[#6B6B6B] mx-auto mb-4" />
            <h3
              className="text-xl font-semibold mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              No invoices yet
            </h3>
            <p
              className="text-[#6B6B6B] mb-6"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Create your first invoice to see it here
            </p>
            <button
              onClick={createNewInvoice}
              className="bg-[#22C55E] text-white px-6 py-2 rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
            >
              Create Invoice
            </button>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 text-center">
            <Search className="w-16 h-16 text-[#6B6B6B] mx-auto mb-4" />
            <h3
              className="text-xl font-semibold mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              No matching invoices
            </h3>
            <p
              className="text-[#6B6B6B] mb-6"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Try adjusting your search or filter criteria
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-black text-white">
                  <tr>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Invoice ID
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Client
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Issue Date
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Due Date
                    </th>
                    <th
                      className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Total
                    </th>
                    <th
                      className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice, index) => (
                    <tr
                      key={invoice.id}
                      className={index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}
                    >
                      <td
                        className="px-6 py-4 font-medium"
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {invoice.invoiceId}
                      </td>
                      <td
                        className="px-6 py-4"
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {invoice.clientName || "—"}
                      </td>
                      <td
                        className="px-6 py-4 text-[#6B6B6B]"
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {invoice.issueDate || "—"}
                      </td>
                      <td
                        className="px-6 py-4 text-[#6B6B6B]"
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {invoice.dueDate || "—"}
                      </td>
                      <td
                        className="px-6 py-4 text-right font-semibold"
                        style={{
                          fontFamily: "Inter, sans-serif",
                          color: "#22C55E",
                        }}
                      >
                        ${invoice.total?.toFixed(2) || "0.00"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => editInvoice(invoice)}
                            className="p-2 text-[#6B6B6B] hover:text-[#22C55E] hover:bg-[#F0FDF4] rounded transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => downloadInvoice(invoice)}
                            className="p-2 text-[#6B6B6B] hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteInvoice(invoice.id)}
                            className="p-2 text-[#6B6B6B] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                            title="Delete"
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
          </div>
        )}
      </div>
    </div>
  );
}
