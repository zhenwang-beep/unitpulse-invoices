import React, { useState, useRef } from "react";
import { X, Upload } from "lucide-react";
import { toast } from "sonner";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { fetchAPI } from "../utils/api";

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  logoPath: string | null;
  logoUrl?: string;
  companyEmail?: string;
  companyPhone?: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: CompanySettings;
  onSave: (settings: CompanySettings) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: SettingsModalProps) {
  const [formData, setFormData] = useState<CompanySettings>({
    companyName: settings.companyName || "",
    companyAddress: settings.companyAddress || "",
    logoPath: settings.logoPath || null,
    logoUrl: settings.logoUrl || "",
    companyEmail: settings.companyEmail || "",
    companyPhone: settings.companyPhone || "",
  });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload PNG, JPG, or SVG.");
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5242880) {
      toast.error("File too large. Maximum size is 5MB.");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("logo", file);

      const response = await fetchAPI("/upload-logo", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload logo");
      }

      const data = await response.json();
      
      // Create a local preview URL
      const previewUrl = URL.createObjectURL(file);
      
      setFormData((prev) => ({
        ...prev,
        logoPath: data.logoPath,
        logoUrl: previewUrl,
      }));

      toast.success("Logo uploaded successfully!");
    } catch (error) {
      console.error("Error uploading logo:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to upload logo"
      );
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      const response = await fetchAPI("/company-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyName: formData.companyName,
          companyAddress: formData.companyAddress,
          logoPath: formData.logoPath,
          companyEmail: formData.companyEmail,
          companyPhone: formData.companyPhone,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      const data = await response.json();
      onSave(data.settings);
      toast.success("Settings saved successfully!");
      onClose();
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Failed to save settings");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E0E0E0]">
          <h2
            className="text-2xl"
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 700,
            }}
          >
            Company Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Logo Upload */}
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Company Logo
            </label>
            <div className="flex items-center gap-4">
              {formData.logoUrl && (
                <div className="w-20 h-20 border border-[#E0E0E0] rounded-lg overflow-hidden flex items-center justify-center bg-[#F5F5F5]">
                  <img
                    src={formData.logoUrl}
                    alt="Company logo"
                    className="w-full h-full object-contain"
                  />
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
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-all duration-200 disabled:opacity-50 cursor-pointer"
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? "Uploading..." : "Upload Logo"}
                </button>
                <p
                  className="text-xs text-[#6B6B6B] mt-1"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  PNG, JPG, or SVG (max 5MB)
                </p>
              </div>
            </div>
          </div>

          {/* Company Name */}
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Company Name
            </label>
            <input
              type="text"
              value={formData.companyName}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  companyName: e.target.value,
                }))
              }
              placeholder="Your Company Name"
              className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
          </div>

          {/* Company Address */}
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Company Address
            </label>
            <textarea
              value={formData.companyAddress}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  companyAddress: e.target.value,
                }))
              }
              placeholder="Street Address&#10;City, State ZIP&#10;Country"
              rows={4}
              className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent resize-none"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
          </div>

          {/* Company Email */}
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Company Email
            </label>
            <input
              type="email"
              value={formData.companyEmail}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  companyEmail: e.target.value,
                }))
              }
              placeholder="yourcompany@example.com"
              className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
          </div>

          {/* Company Phone */}
          <div>
            <label
              className="block text-[#6B6B6B] text-sm mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Company Phone
            </label>
            <input
              type="tel"
              value={formData.companyPhone}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  companyPhone: e.target.value,
                }))
              }
              placeholder="(123) 456-7890"
              className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#4A5D23] focus:border-transparent"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-6 border-t border-[#E0E0E0]">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-all duration-200 cursor-pointer"
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-[#4A5D23] text-white rounded-lg hover:bg-[#3A4A1B] transition-all duration-200 cursor-pointer"
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 700,
            }}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}