import React from "react";
import { useNavigate } from "react-router";
import { FileText } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

export function InvoiceGeneratorWrapper({ children }: Props) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Top Navigation Bar */}
      <div className="border-b border-[#E0E0E0] bg-white px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: "Manrope, sans-serif" }}
          >
            UnitPulse Invoice Generator
          </h1>
          <button
            onClick={() => navigate("/invoices")}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-[#333] transition-colors"
            style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
          >
            <FileText className="w-5 h-5" />
            Manage Invoices
          </button>
        </div>
      </div>

      {/* Main Content */}
      {children}
    </div>
  );
}
