import React, { useState, useRef, useEffect } from "react";
import { Upload, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "../components/Navbar";
import { fetchAPI } from "../utils/api";
import logoPng from "../../assets/logo.svg";

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  logoPath: string | null;
  logoUrl?: string;
  companyEmail?: string;
  companyPhone?: string;
}

const defaultSettings: CompanySettings = {
  companyName: "UnitPulse",
  companyAddress: "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
  logoPath: null,
  logoUrl: logoPng,
  companyEmail: "",
  companyPhone: "",
};

export default function SettingsPage() {
  const [formData, setFormData] = useState<CompanySettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetchAPI("/company-settings");
        const data = await response.json();
        if (data.settings) {
          setFormData({
            companyName: data.settings.companyName || defaultSettings.companyName,
            companyAddress: data.settings.companyAddress || defaultSettings.companyAddress,
            logoPath: data.settings.logoPath || null,
            logoUrl: data.settings.logoUrl || logoPng,
            companyEmail: data.settings.companyEmail || "",
            companyPhone: data.settings.companyPhone || "",
          });
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload PNG, JPG, or SVG.");
      return;
    }
    if (file.size > 5242880) {
      toast.error("File too large. Maximum size is 5MB.");
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const response = await fetchAPI("/upload-logo", { method: "POST", body: fd });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload logo");
      }
      const data = await response.json();
      const previewUrl = URL.createObjectURL(file);
      setFormData((prev) => ({ ...prev, logoPath: data.logoPath, logoUrl: previewUrl }));
      toast.success("Logo uploaded successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload logo");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetchAPI("/company-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: formData.companyName,
          companyAddress: formData.companyAddress,
          logoPath: formData.logoPath,
          companyEmail: formData.companyEmail,
          companyPhone: formData.companyPhone,
        }),
      });
      if (!response.ok) throw new Error("Failed to save settings");
      toast.success("Settings saved successfully!");
    } catch (error) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#16A34A] focus:border-transparent";

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Building2 className="w-7 h-7 text-[#1A1A1A]" />
          <h1
            className="text-2xl sm:text-3xl"
            style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}
          >
            Company Settings
          </h1>
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>
            Loading settings...
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#E0E0E0] p-6 space-y-6">
            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-[#6B6B6B] mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
                Company Logo
              </label>
              <div className="flex items-center gap-4">
                {formData.logoUrl && (
                  <div className="w-20 h-20 border border-[#E0E0E0] rounded-lg overflow-hidden flex items-center justify-center bg-[#F5F5F5] flex-shrink-0">
                    <img src={formData.logoUrl} alt="Company logo" className="w-full h-full object-contain" />
                  </div>
                )}
                <div className="flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-colors disabled:opacity-50 cursor-pointer"
                    style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
                  >
                    <Upload className="w-4 h-4" />
                    {uploading ? "Uploading..." : "Upload Logo"}
                  </button>
                  <p className="text-xs text-[#6B6B6B] mt-1" style={{ fontFamily: "Inter, sans-serif" }}>
                    PNG, JPG, or SVG (max 5MB)
                  </p>
                </div>
              </div>
            </div>

            {/* Company Name */}
            <div>
              <label className="block text-sm font-medium text-[#6B6B6B] mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
                Company Name
              </label>
              <input
                type="text"
                value={formData.companyName}
                onChange={(e) => setFormData((prev) => ({ ...prev, companyName: e.target.value }))}
                placeholder="Your Company Name"
                className={inputClass}
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>

            {/* Company Address */}
            <div>
              <label className="block text-sm font-medium text-[#6B6B6B] mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
                Company Address
              </label>
              <textarea
                value={formData.companyAddress}
                onChange={(e) => setFormData((prev) => ({ ...prev, companyAddress: e.target.value }))}
                placeholder={"Street Address\nCity, State ZIP\nCountry"}
                rows={4}
                className={`${inputClass} resize-none`}
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>

            {/* Company Email */}
            <div>
              <label className="block text-sm font-medium text-[#6B6B6B] mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
                Company Email
              </label>
              <input
                type="email"
                value={formData.companyEmail}
                onChange={(e) => setFormData((prev) => ({ ...prev, companyEmail: e.target.value }))}
                placeholder="yourcompany@example.com"
                className={inputClass}
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>

            {/* Company Phone */}
            <div>
              <label className="block text-sm font-medium text-[#6B6B6B] mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
                Company Phone
              </label>
              <input
                type="tel"
                value={formData.companyPhone}
                onChange={(e) => setFormData((prev) => ({ ...prev, companyPhone: e.target.value }))}
                placeholder="(123) 456-7890"
                className={inputClass}
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>

            {/* Save Button */}
            <div className="pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full px-6 py-3 bg-[#16A34A] text-white rounded-lg hover:bg-[#15803D] transition-colors disabled:opacity-50 cursor-pointer"
                style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
