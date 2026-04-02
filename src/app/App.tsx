import React, { useState, useRef, useEffect } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  Settings,
  X,
  Upload,
  FileText,
  Users,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { useNavigate, useLocation } from "react-router";
import Logo from "../imports/Logo-4-122";
import logoPng from "../assets/logo.svg";
import { generateInvoicePDF } from "./pdf-generator";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { SettingsModal } from "./components/SettingsModal";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthProvider } from "./contexts/AuthContext";
import { UserProfileMenu } from "./components/UserProfileMenu";
import { Navbar } from "./components/Navbar";
import { fetchAPI } from "./utils/api";

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceData {
  invoiceId: string;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientAddress: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  clientCountry: string;
  lineItems: LineItem[];
  taxPercent: number;
  notes: string;
}

export interface CompanySettings {
  companyName: string;
  companyAddress: string;
  logoPath: string | null;
  logoUrl?: string;
  companyEmail?: string;
  companyPhone?: string;
}

// US State tax rates mapping
const STATE_TAX_RATES: { [key: string]: number } = {
  AL: 4.0,
  AK: 0.0,
  AZ: 5.6,
  AR: 6.5,
  CA: 9.5,
  CO: 2.9,
  CT: 6.35,
  DE: 0.0,
  FL: 6.0,
  GA: 4.0,
  HI: 4.0,
  ID: 6.0,
  IL: 6.25,
  IN: 7.0,
  IA: 6.0,
  KS: 6.5,
  KY: 6.0,
  LA: 4.45,
  ME: 5.5,
  MD: 6.0,
  MA: 6.25,
  MI: 6.0,
  MN: 6.875,
  MS: 7.0,
  MO: 4.225,
  MT: 0.0,
  NE: 5.5,
  NV: 6.85,
  NH: 0.0,
  NJ: 6.625,
  NM: 5.125,
  NY: 4.0,
  NC: 4.75,
  ND: 5.0,
  OH: 5.75,
  OK: 4.5,
  OR: 0.0,
  PA: 6.0,
  RI: 7.0,
  SC: 6.0,
  SD: 4.5,
  TN: 7.0,
  TX: 6.25,
  UT: 6.1,
  VT: 6.0,
  VA: 5.3,
  WA: 6.5,
  WV: 6.0,
  WI: 5.0,
  WY: 4.0,
};

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

const COUNTRIES = [
  "United States",
  "Canada",
  "United Kingdom",
  "Australia",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Netherlands",
  "Belgium",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Ireland",
  "Portugal",
  "Greece",
  "Poland",
  "Czech Republic",
  "Hungary",
  "Romania",
  "Bulgaria",
  "Japan",
  "China",
  "India",
  "South Korea",
  "Singapore",
  "Malaysia",
  "Thailand",
  "Indonesia",
  "Philippines",
  "Vietnam",
  "Mexico",
  "Brazil",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru",
  "South Africa",
  "Egypt",
  "Nigeria",
  "Kenya",
  "Morocco",
  "New Zealand",
  "Israel",
  "UAE",
  "Saudi Arabia",
];

function generateInvoiceId() {
  return `INV-${Math.floor(100000 + Math.random() * 900000)}`;
}

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

function getDueDateFromIssueDate(issueDate: string) {
  if (!issueDate) return "";
  const date = new Date(issueDate);
  date.setDate(date.getDate() + 14); // Add 14 days (2 weeks)
  return date.toISOString().split("T")[0];
}

export function InvoiceGeneratorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [showMobilePreview, setShowMobilePreview] =
    useState(false);
  const invoicePreviewRef = useRef<HTMLDivElement>(null);
  const todayDate = getTodayDate();
  const [invoiceData, setInvoiceData] = useState<InvoiceData>({
    invoiceId: generateInvoiceId(),
    issueDate: todayDate,
    dueDate: getDueDateFromIssueDate(todayDate),
    clientName: "",
    clientAddress: "",
    clientCity: "",
    clientState: "CA",
    clientZip: "",
    clientCountry: "United States",
    lineItems: [{ id: Date.now().toString(), description: "", quantity: 1, unitPrice: 0 }],
    taxPercent: 0,
    notes: "",
  });

  const [companySettings, setCompanySettings] =
    useState<CompanySettings>({
      companyName: "UnitPulse",
      companyAddress:
        "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
      logoPath: null,
      logoUrl: logoPng,
      companyEmail: "",
      companyPhone: "",
    });

  const [showSettingsModal, setShowSettingsModal] =
    useState(false);
  
  const [savedItems, setSavedItems] = useState<Array<{id: string; description: string; unitPrice: number}>>([]);
  
  const [savedClients, setSavedClients] = useState<Array<{
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }>>([]);
  
  const [isInvoiceSaved, setIsInvoiceSaved] = useState(false);
  const [showSaveConfirmModal, setShowSaveConfirmModal] = useState(false);

  const [isEditMode, setIsEditMode] = useState(false);
  
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [filteredClients, setFilteredClients] = useState<Array<{
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }>>([]);

  // Load company settings on mount
  useEffect(() => {
    const loadSettings = async () => {
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

    loadSettings();
  }, []);
  
  // Load saved items on mount
  useEffect(() => {
    const loadItems = async () => {
      try {
        const response = await fetchAPI("/items");

        if (response.ok) {
          const data = await response.json();
          setSavedItems(data.items || []);
        }
      } catch (error) {
        console.error("Error loading items:", error);
      }
    };

    loadItems();
  }, []);
  
  // Load saved clients on mount
  useEffect(() => {
    const loadClients = async () => {
      try {
        const response = await fetchAPI("/clients");

        if (response.ok) {
          const data = await response.json();
          setSavedClients(data.clients || []);
        }
      } catch (error) {
        console.error("Error loading clients:", error);
      }
    };

    loadClients();
  }, []);
  
  // Load invoice from location state (when navigating from invoice management)
  useEffect(() => {
    if (location.state?.invoice) {
      const loadedInvoice = location.state.invoice;
      setInvoiceData({
        invoiceId: loadedInvoice.invoiceId,
        issueDate: loadedInvoice.issueDate,
        dueDate: loadedInvoice.dueDate,
        clientName: loadedInvoice.clientName,
        clientAddress: loadedInvoice.clientAddress,
        clientCity: loadedInvoice.clientCity,
        clientState: loadedInvoice.clientState,
        clientZip: loadedInvoice.clientZip,
        clientCountry: loadedInvoice.clientCountry,
        lineItems: loadedInvoice.lineItems,
        taxPercent: loadedInvoice.taxPercent,
        notes: loadedInvoice.notes,
      });
      setIsInvoiceSaved(true);
      setIsEditMode(true);
      toast.success("Invoice loaded for editing");
    }
  }, [location]);
  
  // Function to save item to database
  const saveItem = async (description: string, unitPrice: number) => {
    // Check if item already exists
    const exists = savedItems.some(item => 
      item.description.toLowerCase() === description.toLowerCase()
    );
    
    if (exists || !description.trim()) return;
    
    try {
      const response = await fetchAPI("/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description, unitPrice }),
      });

      if (response.ok) {
        const data = await response.json();
        setSavedItems(prev => [...prev, data.item]);
      }
    } catch (error) {
      console.error("Error saving item:", error);
    }
  };
  
  // Function to save client to database
  const saveClient = async (clientData: {
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }) => {
    // Check if client already exists
    const exists = savedClients.some(client => 
      client.clientName.toLowerCase() === clientData.clientName.toLowerCase()
    );
    
    if (exists || !clientData.clientName.trim()) return;
    
    try {
      const response = await fetchAPI("/clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(clientData),
      });

      if (response.ok) {
        const data = await response.json();
        setSavedClients(prev => [...prev, data.client]);
      }
    } catch (error) {
      console.error("Error saving client:", error);
    }
  };
  
  // Function to save invoice to database
  const saveInvoice = async (downloadAfter = false) => {
    setShowSaveConfirmModal(false);
    try {
      const isUpdate = location.state?.invoice?.id;
      const invoiceId = isUpdate ? location.state.invoice.id : `invoice_${invoiceData.invoiceId}`;
      const endpoint = isUpdate ? `/invoices/${invoiceId}` : "/invoices";

      const response = await fetchAPI(endpoint, {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceData,
          subtotal: calculateSubtotal(),
          tax: calculateTax(),
          total: calculateTotal(),
        }),
      });

      if (response.ok) {
        for (const item of invoiceData.lineItems) {
          if (item.description.trim() && item.unitPrice > 0) {
            await saveItem(item.description, item.unitPrice);
          }
        }
        await saveClient({
          clientName: invoiceData.clientName,
          clientAddress: invoiceData.clientAddress,
          clientCity: invoiceData.clientCity,
          clientState: invoiceData.clientState,
          clientZip: invoiceData.clientZip,
          clientCountry: invoiceData.clientCountry,
        });

        setIsInvoiceSaved(true);
        if (downloadAfter) handleDownloadPDF();
        toast.success(isUpdate ? "Invoice updated!" : "Invoice saved!", {
          action: { label: "View Invoice", onClick: () => navigate("/") },
        });
        if (!isUpdate) resetInvoice();
      } else {
        toast.error("Failed to save invoice");
      }
    } catch (error) {
      console.error("Error saving invoice:", error);
      toast.error("Failed to save invoice");
    }
  };

  const resetInvoice = () => {
    const today = getTodayDate();
    setInvoiceData({
      invoiceId: generateInvoiceId(),
      issueDate: today,
      dueDate: getDueDateFromIssueDate(today),
      clientName: "",
      clientAddress: "",
      clientCity: "",
      clientState: "CA",
      clientZip: "",
      clientCountry: "United States",
      lineItems: [{ id: Date.now().toString(), description: "", quantity: 1, unitPrice: 0 }],
      taxPercent: 0,
      notes: "",
    });
    setIsInvoiceSaved(false);
    setShowSaveConfirmModal(false);
  };

  const updateInvoice = (updates: Partial<InvoiceData>) => {
    setInvoiceData((prev) => ({ ...prev, ...updates }));
    // Reset saved state when invoice is edited
    setIsInvoiceSaved(false);
  };
  
  const applyTax = () => {
    const state = invoiceData.clientState;
    if (STATE_TAX_RATES[state] !== undefined) {
      updateInvoice({ taxPercent: STATE_TAX_RATES[state] });
      toast.success(`Applied ${STATE_TAX_RATES[state]}% tax rate for ${state}`);
    } else {
      toast.error("Tax rate not available for selected state");
    }
  };

  const handleClientNameChange = (value: string) => {
    updateInvoice({ clientName: value });
    
    // Filter clients based on input
    if (value.trim()) {
      const filtered = savedClients.filter(client =>
        client.clientName.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredClients(filtered);
      setShowClientDropdown(filtered.length > 0);
    } else {
      setFilteredClients(savedClients);
      setShowClientDropdown(savedClients.length > 0);
    }
  };

  const selectClient = (client: {
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }) => {
    updateInvoice({
      clientName: client.clientName,
      clientAddress: client.clientAddress,
      clientCity: client.clientCity,
      clientState: client.clientState,
      clientZip: client.clientZip,
      clientCountry: client.clientCountry,
    });
    setShowClientDropdown(false);
  };

  const updateLineItem = (
    id: string,
    field: keyof LineItem,
    value: string | number,
  ) => {
    setInvoiceData((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }));
    
    // Reset saved state when invoice is edited
    setIsInvoiceSaved(false);
  };

  const addLineItem = () => {
    const newItem: LineItem = {
      id: Date.now().toString(),
      description: "",
      quantity: 1,
      unitPrice: 0,
    };
    setInvoiceData((prev) => ({
      ...prev,
      lineItems: [...prev.lineItems, newItem],
    }));
  };

  const removeLineItem = (id: string) => {
    setInvoiceData((prev) => ({
      ...prev,
      lineItems: prev.lineItems.filter(
        (item) => item.id !== id,
      ),
    }));
  };

  const calculateSubtotal = () => {
    return invoiceData.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
  };

  const calculateTax = () => {
    return (calculateSubtotal() * invoiceData.taxPercent) / 100;
  };

  const calculateTotal = () => {
    return calculateSubtotal() + calculateTax();
  };

  const handleDownloadPDF = async () => {
    try {
      // Convert logo to PNG data URL for jsPDF and get dimensions
      let logoDataUrl = logoPng;
      let logoWidth = 32;
      let logoHeight = 32;

      // Helper function to convert any image to PNG data URL and get dimensions
      const convertImageToPNG = async (
        imgSrc: string,
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
            // Physical display size in PDF (max 48px)
            const maxDisplaySize = 32;
            // Resolution multiplier for high-quality rendering (4x resolution)
            const resolutionScale = 4;

            let displayWidth = img.width;
            let displayHeight = img.height;

            // Calculate display dimensions (max 48px)
            if (
              displayWidth > maxDisplaySize ||
              displayHeight > maxDisplaySize
            ) {
              if (displayWidth > displayHeight) {
                displayHeight =
                  (displayHeight / displayWidth) *
                  maxDisplaySize;
                displayWidth = maxDisplaySize;
              } else {
                displayWidth =
                  (displayWidth / displayHeight) *
                  maxDisplaySize;
                displayHeight = maxDisplaySize;
              }
            }

            // Render at high resolution (4x the display size)
            const canvasWidth = displayWidth * resolutionScale;
            const canvasHeight =
              displayHeight * resolutionScale;

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Could not get canvas context"));
              return;
            }

            // Enable high-quality image rendering
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";

            // Fill with white background
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);

            // Draw image at high resolution
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

            // Convert to PNG data URL with maximum quality
            // Return display dimensions (not canvas dimensions) for PDF placement
            resolve({
              dataUrl: canvas.toDataURL("image/png", 1.0),
              width: displayWidth,
              height: displayHeight,
            });
          };

          img.onerror = () =>
            reject(new Error("Failed to load image"));
          img.src = imgSrc;
        });
      };

      if (companySettings.logoUrl && companySettings.logoPath) {
        // Custom logo uploaded - fetch and convert to PNG
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
          // Convert default logo to PNG as fallback
          const result = await convertImageToPNG(logoPng);
          logoDataUrl = result.dataUrl;
          logoWidth = result.width;
          logoHeight = result.height;
        }
      } else {
        // Convert default UnitPulse logo to PNG
        const result = await convertImageToPNG(logoPng);
        logoDataUrl = result.dataUrl;
        logoWidth = result.width;
        logoHeight = result.height;
      }

      const pdf = generateInvoicePDF(
        invoiceData,
        calculateSubtotal(),
        calculateTax(),
        calculateTotal(),
        logoDataUrl,
        logoWidth,
        logoHeight,
        companySettings,
      );
      pdf.save(`${invoiceData.invoiceId}.pdf`);
      toast.success("Invoice downloaded successfully!");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#FCF9F8]">
      <Toaster position="top-center" />
      <Navbar />

      {/* Save Confirm Modal */}
      {showSaveConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2 className="text-xl mb-1" style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}>
              Ready to save?
            </h2>
            <p className="text-sm text-[#6B6B6B] mb-6" style={{ fontFamily: "Inter, sans-serif" }}>
              Please confirm you've reviewed the invoice details before saving.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => saveInvoice(false)}
                className="w-full px-6 py-3 bg-[#4A5D23] text-white rounded-lg hover:bg-[#3A4A1B] transition-colors cursor-pointer"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}
              >
                Save
              </button>
              <button
                onClick={() => saveInvoice(true)}
                className="w-full px-6 py-3 border border-[#4A5D23] text-[#4A5D23] rounded-lg hover:bg-[#F5F7EE] transition-colors cursor-pointer"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
              >
                Save & Download PDF
              </button>
              <button
                onClick={() => setShowSaveConfirmModal(false)}
                className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors cursor-pointer py-1"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={companySettings}
        onSave={setCompanySettings}
      />

      {/* Desktop Two-Column Layout */}
      <div className="hidden lg:grid lg:grid-cols-[45%_55%] flex-1 overflow-hidden">
        {/* Left Panel - Form Editor (Scrollable) */}
        <div className="border-r border-[#E0E0E0] overflow-y-auto">
          <div className="p-8">
            <FormEditor
              invoiceData={invoiceData}
              updateInvoice={updateInvoice}
              updateLineItem={updateLineItem}
              addLineItem={addLineItem}
              removeLineItem={removeLineItem}
              generateInvoiceId={generateInvoiceId}
              calculateSubtotal={calculateSubtotal}
              calculateTax={calculateTax}
              calculateTotal={calculateTotal}
              onOpenSettings={() => setShowSettingsModal(true)}
              applyTax={applyTax}
              isEditMode={isEditMode}
              saveItem={saveItem}
              savedItems={savedItems}
              savedClients={savedClients}
              handleClientNameChange={handleClientNameChange}
              selectClient={selectClient}
              showClientDropdown={showClientDropdown}
              setShowClientDropdown={setShowClientDropdown}
              filteredClients={filteredClients}
              setFilteredClients={setFilteredClients}
            />
          </div>
        </div>

        {/* Right Panel - Invoice Preview (Fixed, Scrollable independently) */}
        <div className="bg-[#F5F5F5] overflow-y-auto">
          <div className="p-8">
            <InvoicePreview
              ref={invoicePreviewRef}
              invoiceData={invoiceData}
              companySettings={companySettings}
              subtotal={calculateSubtotal()}
              tax={calculateTax()}
              total={calculateTotal()}
              onDownload={handleDownloadPDF}
              onSave={() => setShowSaveConfirmModal(true)}
              isInvoiceSaved={isInvoiceSaved}
            />
          </div>
        </div>
      </div>

      {/* Mobile Vertical Layout */}
      <div className="lg:hidden flex-1 overflow-y-auto">
        <div className="p-6">
          <FormEditor
            invoiceData={invoiceData}
            updateInvoice={updateInvoice}
            updateLineItem={updateLineItem}
            addLineItem={addLineItem}
            removeLineItem={removeLineItem}
            generateInvoiceId={generateInvoiceId}
            calculateSubtotal={calculateSubtotal}
            calculateTax={calculateTax}
            calculateTotal={calculateTotal}
            onOpenSettings={() => setShowSettingsModal(true)}
            applyTax={applyTax}
            isMobile={true}
            isEditMode={isEditMode}
            saveItem={saveItem}
            savedItems={savedItems}
            savedClients={savedClients}
            handleClientNameChange={handleClientNameChange}
            selectClient={selectClient}
            showClientDropdown={showClientDropdown}
            setShowClientDropdown={setShowClientDropdown}
            filteredClients={filteredClients}
            setFilteredClients={setFilteredClients}
          />

          <button
            onClick={() =>
              setShowMobilePreview(!showMobilePreview)
            }
            className="w-full mt-6 bg-black text-white py-3 px-6 rounded-lg transition-all duration-200 hover:bg-[#333] cursor-pointer"
            style={{ fontFamily: "Manrope, sans-serif" }}
          >
            {showMobilePreview
              ? "Hide Preview"
              : "Preview Invoice"}
          </button>

          {showMobilePreview && (
            <div className="mt-6">
              <InvoicePreview
                ref={invoicePreviewRef}
                invoiceData={invoiceData}
                companySettings={companySettings}
                subtotal={calculateSubtotal()}
                tax={calculateTax()}
                total={calculateTotal()}
                onDownload={handleDownloadPDF}
                onSave={saveInvoice}
                isInvoiceSaved={isInvoiceSaved}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FormEditorProps {
  invoiceData: InvoiceData;
  updateInvoice: (updates: Partial<InvoiceData>) => void;
  updateLineItem: (
    id: string,
    field: keyof LineItem,
    value: string | number,
  ) => void;
  addLineItem: () => void;
  removeLineItem: (id: string) => void;
  generateInvoiceId: () => string;
  calculateSubtotal: () => number;
  calculateTax: () => number;
  calculateTotal: () => number;
  onOpenSettings: () => void;
  applyTax: () => void;
  isMobile?: boolean;
  isEditMode: boolean;
  saveItem: (description: string, unitPrice: number) => void;
  savedItems: Array<{id: string; description: string; unitPrice: number}>;
  savedClients: Array<{
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }>;
  handleClientNameChange: (value: string) => void;
  selectClient: (client: {
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }) => void;
  showClientDropdown: boolean;
  setShowClientDropdown: (show: boolean) => void;
  filteredClients: Array<{
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }>;
  setFilteredClients: (clients: Array<{
    id: string;
    clientName: string;
    clientAddress: string;
    clientCity: string;
    clientState: string;
    clientZip: string;
    clientCountry: string;
  }>) => void;
}

function FormEditor({
  invoiceData,
  updateInvoice,
  updateLineItem,
  addLineItem,
  removeLineItem,
  generateInvoiceId,
  calculateSubtotal,
  calculateTax,
  calculateTotal,
  onOpenSettings,
  applyTax,
  isMobile = false,
  isEditMode,
  saveItem,
  savedItems,
  savedClients,
  handleClientNameChange,
  selectClient,
  showClientDropdown,
  setShowClientDropdown,
  filteredClients,
  setFilteredClients,
}: FormEditorProps) {
  const navigate = useNavigate();
  const [activeItemDropdown, setActiveItemDropdown] = useState<string | null>(null);

  const getFilteredSavedItems = (query: string) => {
    if (!query.trim()) return savedItems;
    return savedItems.filter(item =>
      item.description.toLowerCase().includes(query.toLowerCase())
    );
  };
  
  return (
    <div className="space-y-8">
      <div className="mb-2">
        <h1
          className="text-3xl tracking-tight"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 700,
          }}
        >
          {isEditMode ? "Edit Invoice" : "Invoice Generator"}
        </h1>
      </div>

      {/* Section 1: Invoice Meta */}
      <section className="space-y-4">
        <h2
          className="uppercase tracking-wider text-xs text-black"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 600,
          }}
        >
          Invoice Details
        </h2>

        <div className="space-y-3">
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-1.5"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Invoice ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={invoiceData.invoiceId}
                readOnly
                className="flex-1 px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-[#F5F5F5]"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
              <button
                onClick={() =>
                  updateInvoice({
                    invoiceId: generateInvoiceId(),
                  })
                }
                className="px-4 py-2.5 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-all duration-200 cursor-pointer"
                title="Regenerate ID"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-[#6B6B6B] text-sm mb-1.5"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Issue Date
              </label>
              <input
                type="date"
                value={invoiceData.issueDate}
                onChange={(e) => {
                  const newIssueDate = e.target.value;
                  updateInvoice({ 
                    issueDate: newIssueDate,
                    dueDate: getDueDateFromIssueDate(newIssueDate)
                  });
                }}
                className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>
            <div>
              <label
                className="block text-[#6B6B6B] text-sm mb-1.5"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Due Date
              </label>
              <input
                type="date"
                value={invoiceData.dueDate}
                onChange={(e) =>
                  updateInvoice({ dueDate: e.target.value })
                }
                className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Bill To */}
      <section className="space-y-4">
        <h2
          className="uppercase tracking-wider text-xs text-black"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 600,
          }}
        >
          Bill To
        </h2>

        <div className="space-y-3">
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-1.5"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Client Name
            </label>
            <div className="relative">
              <input
                type="text"
                value={invoiceData.clientName}
                onChange={(e) => handleClientNameChange(e.target.value)}
                onFocus={() => {
                  if (savedClients.length > 0) {
                    setFilteredClients(savedClients);
                    setShowClientDropdown(true);
                  }
                }}
                onBlur={() => {
                  // Delay hiding to allow click on dropdown
                  setTimeout(() => setShowClientDropdown(false), 200);
                }}
                placeholder="Enter or select client name"
                className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent cursor-pointer"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
              {showClientDropdown && filteredClients.length > 0 && (
                <div 
                  className="absolute z-10 w-full mt-1 bg-white border border-[#E0E0E0] rounded-lg shadow-lg max-h-60 overflow-y-auto"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  {filteredClients.map((client) => (
                    <div
                      key={client.id}
                      onClick={() => selectClient(client)}
                      className="px-4 py-3 hover:bg-[#F5F5F5] cursor-pointer transition-colors border-b border-[#F0F0F0] last:border-b-0"
                    >
                      <div className="font-medium text-[#1A1A1A]">
                        {client.clientName}
                      </div>
                      <div className="text-sm text-[#6B6B6B] mt-0.5">
                        {client.clientAddress}
                        {client.clientCity && `, ${client.clientCity}`}
                        {client.clientState && `, ${client.clientState}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-1.5"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Address
            </label>
            <input
              type="text"
              value={invoiceData.clientAddress}
              onChange={(e) =>
                updateInvoice({ clientAddress: e.target.value })
              }
              placeholder="Street address"
              className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-[#6B6B6B] text-sm mb-1.5"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                City
              </label>
              <input
                type="text"
                value={invoiceData.clientCity}
                onChange={(e) =>
                  updateInvoice({ clientCity: e.target.value })
                }
                placeholder="City"
                className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>
            <div>
              <label
                className="block text-[#6B6B6B] text-sm mb-1.5"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                State
              </label>
              <div className="relative">
                <select
                  value={invoiceData.clientState}
                  onChange={(e) =>
                    updateInvoice({
                      clientState: e.target.value,
                    })
                  }
                  className="w-full pl-4 pr-10 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent appearance-none cursor-pointer"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  {US_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B6B6B] pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-[#6B6B6B] text-sm mb-1.5"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Zip Code
              </label>
              <input
                type="text"
                value={invoiceData.clientZip}
                onChange={(e) =>
                  updateInvoice({ clientZip: e.target.value })
                }
                placeholder="Zip"
                className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>
            <div>
              <label
                className="block text-[#6B6B6B] text-sm mb-1.5"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Country
              </label>
              <div className="relative">
                <select
                  value={invoiceData.clientCountry}
                  onChange={(e) =>
                    updateInvoice({
                      clientCountry: e.target.value,
                    })
                  }
                  className="w-full pl-4 pr-10 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent appearance-none cursor-pointer"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  {COUNTRIES.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B6B6B] pointer-events-none" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Line Items */}
      <section className="space-y-4">
        <h2
          className="uppercase tracking-wider text-xs text-black"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 600,
          }}
        >
          Line Items
        </h2>

        <div className="space-y-3">
          {/* Line Items Forms - Show first */}
          {invoiceData.lineItems.length > 0 && (
            <div className="space-y-3 mt-4">
              {invoiceData.lineItems.map((item, index) => (
                <div
                  key={item.id}
                  className="p-4 border border-[#E0E0E0] rounded-lg space-y-3"
                >
                  <div className="flex justify-between items-center">
                    <span
                      className="text-sm text-[#6B6B6B]"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Item {index + 1}
                    </span>
                    <button
                      onClick={() => removeLineItem(item.id)}
                      className="text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => {
                        updateLineItem(item.id, "description", e.target.value);
                      }}
                      onFocus={() => {
                        if (savedItems.length > 0) setActiveItemDropdown(item.id);
                      }}
                      onBlur={() => {
                        setTimeout(() => setActiveItemDropdown(null), 200);
                      }}
                      placeholder="Item description"
                      className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                      style={{ fontFamily: "Inter, sans-serif" }}
                    />
                    {activeItemDropdown === item.id && getFilteredSavedItems(item.description).length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-[#E0E0E0] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {getFilteredSavedItems(item.description).map((savedItem) => (
                          <div
                            key={savedItem.id}
                            onClick={() => {
                              updateLineItem(item.id, "description", savedItem.description);
                              updateLineItem(item.id, "unitPrice", savedItem.unitPrice);
                              setActiveItemDropdown(null);
                            }}
                            className="px-4 py-3 hover:bg-[#F5F5F5] cursor-pointer transition-colors border-b border-[#F0F0F0] last:border-b-0 flex items-center justify-between"
                          >
                            <span className="text-sm font-medium text-[#1A1A1A]" style={{ fontFamily: "Inter, sans-serif" }}>
                              {savedItem.description}
                            </span>
                            <span className="text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>
                              ${savedItem.unitPrice.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label
                        className="block text-[#6B6B6B] text-xs mb-1"
                        style={{
                          fontFamily: "Manrope, sans-serif",
                        }}
                      >
                        Qty
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) =>
                          updateLineItem(
                            item.id,
                            "quantity",
                            parseFloat(e.target.value) || 0,
                          )
                        }
                        className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                        style={{ fontFamily: "Inter, sans-serif" }}
                      />
                    </div>

                    <div>
                      <label
                        className="block text-[#6B6B6B] text-xs mb-1"
                        style={{
                          fontFamily: "Manrope, sans-serif",
                        }}
                      >
                        Unit Price
                      </label>
                      <div className="relative">
                        <span
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]"
                          style={{
                            fontFamily: "Inter, sans-serif",
                          }}
                        >
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateLineItem(
                              item.id,
                              "unitPrice",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="w-full pl-7 pr-3 py-2 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                          style={{
                            fontFamily: "Inter, sans-serif",
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        className="block text-[#6B6B6B] text-xs mb-1"
                        style={{
                          fontFamily: "Manrope, sans-serif",
                        }}
                      >
                        Total
                      </label>
                      <div
                        className="px-3 py-2 border border-[#E0E0E0] rounded-lg bg-[#F5F5F5]"
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        $
                        {(item.quantity * item.unitPrice).toFixed(
                          2,
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Item Button */}
          <button
            onClick={addLineItem}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#4A5D23] text-white rounded-lg hover:bg-[#3A4A1B] transition-all duration-200 cursor-pointer ${
              invoiceData.lineItems.length > 0 ? "mt-4" : ""
            }`}
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 600,
            }}
          >
            <Plus className="w-5 h-5" />
            Add Item
          </button>
        </div>
      </section>

      {/* Section 4: Summary */}
      <section className="space-y-4">
        <h2
          className="uppercase tracking-wider text-xs text-black"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 600,
          }}
        >
          Summary
        </h2>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span
              className="text-[#6B6B6B]"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Subtotal
            </span>
            <span style={{ fontFamily: "Inter, sans-serif" }}>
              ${calculateSubtotal().toFixed(2)}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <label
                className="text-[#6B6B6B] text-sm"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Tax %:
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={applyTax}
                  className="px-3 py-2 bg-[#4A5D23] text-white rounded-lg hover:bg-[#3A4A1B] transition-all text-sm whitespace-nowrap cursor-pointer"
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  Apply Tax
                </button>
                {invoiceData.taxPercent > 0 && (
                  <button
                    onClick={() => updateInvoice({ taxPercent: 0 })}
                    className="px-3 py-2 border border-[#E0E0E0] text-[#6B6B6B] rounded-lg hover:bg-[#F5F5F5] transition-all text-sm whitespace-nowrap cursor-pointer"
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    Reset
                  </button>
                )}
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={invoiceData.taxPercent}
                    onChange={(e) =>
                      updateInvoice({
                        taxPercent:
                          parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 pr-7 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
                    style={{ fontFamily: "Inter, sans-serif" }}
                  />
                  <span
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] pointer-events-none"
                    style={{ fontFamily: "Inter, sans-serif" }}
                  >
                    %
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span
              className="text-[#6B6B6B]"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Tax Amount
            </span>
            <span style={{ fontFamily: "Inter, sans-serif" }}>
              ${calculateTax().toFixed(2)}
            </span>
          </div>

          <div className="pt-3 border-t border-[#E0E0E0]">
            <div className="flex justify-between items-center">
              <span
                className="text-xl"
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 700,
                }}
              >
                Total Due
              </span>
              <span
                className="text-2xl text-[#4A5D23]"
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 700,
                }}
              >
                ${calculateTotal().toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 5: Notes */}
      <section className="space-y-4">
        <h2
          className="uppercase tracking-wider text-xs text-black"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 600,
          }}
        >
          Notes
        </h2>

        <textarea
          value={invoiceData.notes}
          onChange={(e) =>
            updateInvoice({ notes: e.target.value })
          }
          placeholder="Payment due within 30 days"
          rows={3}
          className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent resize-none"
          style={{ fontFamily: "Inter, sans-serif" }}
        />
      </section>

      {!isMobile && (
        <button
          className="w-full bg-black text-white py-3 px-6 rounded-lg transition-all duration-200 hover:bg-[#333] cursor-pointer"
          style={{
            fontFamily: "Manrope, sans-serif",
            fontWeight: 700,
          }}
          onClick={() =>
            window.scrollTo({ top: 0, behavior: "smooth" })
          }
        >
          Preview Invoice
        </button>
      )}
    </div>
  );
}

interface InvoicePreviewProps {
  invoiceData: InvoiceData;
  companySettings: CompanySettings;
  subtotal: number;
  tax: number;
  total: number;
  onDownload: () => void;
  onSave: () => void;
  isInvoiceSaved: boolean;
}

const InvoicePreview = React.forwardRef<
  HTMLDivElement,
  InvoicePreviewProps
>(
  (
    {
      invoiceData,
      companySettings,
      subtotal,
      tax,
      total,
      onDownload,
      onSave,
      isInvoiceSaved,
    },
    ref,
  ) => {
    return (
      <div className="space-y-6">
        {/* Invoice Card */}
        <div
          ref={ref}
          className="invoice-pdf-container bg-white rounded-2xl p-8 md:p-12 shadow-lg"
          style={{
            fontFamily: "Inter, sans-serif",
            color: "#000000",
            backgroundColor: "#FFFFFF",
          }}
        >
          <style>{`
            .invoice-pdf-container * {
              color: inherit !important;
              background-color: transparent !important;
              border-color: #E0E0E0 !important;
            }
            .invoice-pdf-container .bg-black {
              background-color: #000000 !important;
            }
            .invoice-pdf-container .bg-white {
              background-color: #FFFFFF !important;
            }
            .invoice-pdf-container .bg-\\[\\#FAFAFA\\] {
              background-color: #FAFAFA !important;
            }
            .invoice-pdf-container .text-white {
              color: #FFFFFF !important;
            }
            .invoice-pdf-container .text-black {
              color: #000000 !important;
            }
            .invoice-pdf-container .text-\\[\\#6B6B6B\\] {
              color: #6B6B6B !important;
            }
            .invoice-pdf-container .text-\\[\\#22C55E\\] {
              color: #22C55E !important;
            }
            .invoice-pdf-container .border-black {
              border-color: #000000 !important;
            }
            .invoice-pdf-container .border-\\[\\#E0E0E0\\] {
              border-color: #E0E0E0 !important;
            }
          `}</style>

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start gap-6 mb-6">
            <div className="flex items-center gap-3">
              {companySettings.logoUrl && (
                <div style={{ width: "40px", height: "40px" }}>
                  {companySettings.logoPath ? (
                    <img
                      src={companySettings.logoUrl}
                      alt={companySettings.companyName}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <Logo />
                  )}
                </div>
              )}
              <span
                className="text-xl"
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 700,
                }}
              >
                {companySettings.companyName}
              </span>
            </div>
            <div className="text-right text-sm">
              <div
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 600,
                }}
              >
                {companySettings.companyName}
              </div>
              {companySettings.companyAddress
                .split("\n")
                .map((line, i) => (
                  <div key={i} className="text-[#6B6B6B]">
                    {line}
                  </div>
                ))}
              {companySettings.companyEmail && (
                <div className="text-[#6B6B6B]">
                  {companySettings.companyEmail}
                </div>
              )}
              {companySettings.companyPhone && (
                <div className="text-[#6B6B6B]">
                  {companySettings.companyPhone}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-black mb-6"></div>

          {/* Invoice Title and Meta */}
          <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-8">
            <h1
              className="text-3xl md:text-4xl tracking-tight"
              style={{
                fontFamily: "Manrope, sans-serif",
                fontWeight: 700,
              }}
            >
              INVOICE
            </h1>
            <div className="text-right text-sm">
              <div className="mb-1">
                <span className="text-[#6B6B6B]">
                  Invoice ID:{" "}
                </span>
                <span
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {invoiceData.invoiceId}
                </span>
              </div>
              <div className="mb-1">
                <span className="text-[#6B6B6B]">
                  Issue Date:{" "}
                </span>
                {invoiceData.issueDate || "—"}
              </div>
              <div>
                <span className="text-[#6B6B6B]">
                  Due Date:{" "}
                </span>
                {invoiceData.dueDate || "—"}
              </div>
            </div>
          </div>

          {/* From / Bill To */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
              <div
                className="uppercase text-xs tracking-wider mb-2"
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 600,
                }}
              >
                FROM
              </div>
              <div className="text-sm">
                <div
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {companySettings.companyName}
                </div>
                {companySettings.companyAddress
                  .split("\n")
                  .map((line, i) => (
                    <div key={i} className="text-[#6B6B6B]">
                      {line}
                    </div>
                  ))}
                {companySettings.companyEmail && (
                  <div className="text-[#6B6B6B]">
                    {companySettings.companyEmail}
                  </div>
                )}
                {companySettings.companyPhone && (
                  <div className="text-[#6B6B6B]">
                    {companySettings.companyPhone}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div
                className="uppercase text-xs tracking-wider mb-2"
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 600,
                }}
              >
                BILL TO
              </div>
              <div className="text-sm">
                <div
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {invoiceData.clientName || "—"}
                </div>
                {invoiceData.clientAddress && (
                  <div className={`text-[#6B6B6B]`}>
                    {invoiceData.clientAddress}
                  </div>
                )}
                {(invoiceData.clientCity ||
                  invoiceData.clientState ||
                  invoiceData.clientZip) && (
                  <div className="text-[#6B6B6B]">
                    {invoiceData.clientCity}
                    {invoiceData.clientCity &&
                      (invoiceData.clientState ||
                        invoiceData.clientZip) &&
                      ", "}
                    {invoiceData.clientState}
                    {invoiceData.clientState &&
                      invoiceData.clientZip &&
                      " "}
                    {invoiceData.clientZip}
                  </div>
                )}
                {invoiceData.clientCountry && (
                  <div className="text-[#6B6B6B]">
                    {invoiceData.clientCountry}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="h-px bg-black mb-6"></div>

          {/* Line Items Table */}
          <div className="mb-8">
            <div className="bg-black text-white overflow-hidden">
              <div
                className="grid grid-cols-12 gap-4 px-4 py-3 text-xs uppercase tracking-wider"
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 600,
                }}
              >
                <div className="col-span-6">
                  Item Description
                </div>
                <div className="col-span-2 text-center">
                  Qty
                </div>
                <div className="col-span-2 text-right">
                  Unit Price
                </div>
                <div className="col-span-2 text-right">
                  Total
                </div>
              </div>
            </div>

            {invoiceData.lineItems.map((item, index) => (
              <div
                key={item.id}
                className={`grid grid-cols-12 gap-4 px-4 py-3 text-sm ${
                  index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"
                }`}
              >
                <div className="col-span-6">
                  {item.description || "—"}
                </div>
                <div className="col-span-2 text-center">
                  {item.quantity}
                </div>
                <div className="col-span-2 text-right">
                  ${item.unitPrice.toFixed(2)}
                </div>
                <div className="col-span-2 text-right">
                  ${(item.quantity * item.unitPrice).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="flex justify-end mb-8">
            <div className="w-full md:w-64 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#6B6B6B]">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B6B6B]">
                  Tax ({invoiceData.taxPercent}%)
                </span>
                <span>${tax.toFixed(2)}</span>
              </div>
              <div className="h-px bg-[#E0E0E0] my-2"></div>
              <div className="flex justify-between items-center">
                <span
                  className="text-lg"
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 700,
                  }}
                >
                  Total Due
                </span>
                <span
                  className="text-2xl text-[#22C55E]"
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 700,
                  }}
                >
                  ${total.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoiceData.notes && (
            <>
              <div className="h-px bg-[#E0E0E0] mb-4"></div>
              <div className="text-sm italic text-[#6B6B6B] mb-6">
                {invoiceData.notes}
              </div>
            </>
          )}

          {/* Footer */}
          <div
            className="text-center text-sm text-[#6B6B6B] pt-6 border-t border-[#E0E0E0]"
            style={{ fontFamily: "Manrope, sans-serif" }}
          >
            Thank you for your business.
          </div>
        </div>

        {/* Action Buttons */}
        <div className="sticky bottom-0 bg-[#F5F5F5] pt-6 -mx-8 px-8 pb-8">
          <style>{`
            .tooltip-wrapper {
              position: relative;
            }
            .tooltip-wrapper:hover .tooltip-text {
              visibility: visible;
              opacity: 1;
            }
            .tooltip-text {
              visibility: hidden;
              opacity: 0;
              position: absolute;
              bottom: 100%;
              left: 50%;
              transform: translateX(-50%);
              margin-bottom: 8px;
              padding: 8px 12px;
              background-color: #1F2937;
              color: white;
              font-size: 13px;
              border-radius: 6px;
              white-space: nowrap;
              transition: opacity 0.2s;
              pointer-events: none;
              z-index: 50;
              font-family: Inter, sans-serif;
            }
            .tooltip-text::after {
              content: "";
              position: absolute;
              top: 100%;
              left: 50%;
              margin-left: -5px;
              border-width: 5px;
              border-style: solid;
              border-color: #1F2937 transparent transparent transparent;
            }
          `}</style>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() =>
                window.scrollTo({ top: 0, behavior: "smooth" })
              }
              className="px-6 py-3 bg-white border border-black rounded-lg hover:bg-[#F5F5F5] transition-all duration-200 cursor-pointer"
              style={{
                fontFamily: "Manrope, sans-serif",
                fontWeight: 600,
              }}
            >
              Edit
            </button>
            <button
              onClick={onSave}
              className="px-6 py-3 bg-[#4A5D23] text-white rounded-lg hover:bg-[#3A4A1B] transition-all duration-200 cursor-pointer"
              style={{
                fontFamily: "Manrope, sans-serif",
                fontWeight: 600,
              }}
            >
              Save
            </button>
            <div className="tooltip-wrapper">
              {!isInvoiceSaved && (
                <span className="tooltip-text">
                  Please save the invoice first
                </span>
              )}
              <button
                onClick={isInvoiceSaved ? onDownload : undefined}
                disabled={!isInvoiceSaved}
                className={`w-full px-6 py-3 text-white rounded-lg transition-all duration-200 ${
                  isInvoiceSaved 
                    ? 'bg-[#4A5D23] hover:bg-[#3A4A1B] cursor-pointer'
                    : 'bg-gray-300 cursor-not-allowed opacity-60'
                }`}
                style={{
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 600,
                }}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

InvoicePreview.displayName = "InvoicePreview";

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-center" />
      <RouterProvider router={router} />
    </AuthProvider>
  );
}