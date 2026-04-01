import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Save, Search, Package } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Navbar } from "../components/Navbar";
import { fetchAPI } from "../utils/api";

interface SavedItem {
  id: string;
  description: string;
  unitPrice: number;
  createdAt: string;
  updatedAt?: string;
}

export default function ItemManagement() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingItem, setEditingItem] = useState<SavedItem | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ description: "", unitPrice: 0 });

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = items.filter((item) =>
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const loadItems = async () => {
    try {
      setLoading(true);
      const response = await fetchAPI("/items");
      if (response.ok) {
        const data = await response.json();
        const sorted = (data.items || []).sort((a: SavedItem, b: SavedItem) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setItems(sorted);
      } else {
        toast.error("Failed to load items");
      }
    } catch (error) {
      console.error("Error loading items:", error);
      toast.error("Failed to load items");
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async () => {
    if (!formData.description.trim()) {
      toast.error("Please enter an item description");
      return;
    }
    if (formData.unitPrice <= 0) {
      toast.error("Please enter a valid unit price");
      return;
    }
    try {
      const response = await fetchAPI("/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        toast.success("Item added successfully!");
        setShowAddModal(false);
        setFormData({ description: "", unitPrice: 0 });
        loadItems();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to add item");
      }
    } catch (error) {
      console.error("Error adding item:", error);
      toast.error("Failed to add item");
    }
  };

  const handleUpdateItem = async () => {
    if (!editingItem) return;
    if (!formData.description.trim()) {
      toast.error("Please enter an item description");
      return;
    }
    if (formData.unitPrice <= 0) {
      toast.error("Please enter a valid unit price");
      return;
    }
    try {
      const response = await fetchAPI(`/items/${editingItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        toast.success("Item updated successfully!");
        setEditingItem(null);
        setFormData({ description: "", unitPrice: 0 });
        loadItems();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to update item");
      }
    } catch (error) {
      console.error("Error updating item:", error);
      toast.error("Failed to update item");
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      const response = await fetchAPI(`/items/${itemId}`, { method: "DELETE" });
      if (response.ok) {
        toast.success("Item deleted successfully!");
        loadItems();
      } else {
        toast.error("Failed to delete item");
      }
    } catch (error) {
      console.error("Error deleting item:", error);
      toast.error("Failed to delete item");
    }
  };

  const startEdit = (item: SavedItem) => {
    setEditingItem(item);
    setFormData({ description: item.description, unitPrice: item.unitPrice });
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setFormData({ description: "", unitPrice: 0 });
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Toaster position="top-center" />
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1
                className="text-3xl font-bold mb-1"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Saved Items
              </h1>
              <p className="text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>
                Manage your frequently used invoice items
              </p>
            </div>
            <button
              onClick={() => { setFormData({ description: "", unitPrice: 0 }); setShowAddModal(true); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Item</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>

          {/* Search Bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B6B6B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items by description..."
                className="w-full pl-11 pr-4 py-3 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="p-3 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="mt-3 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>
              Showing {filteredItems.length} of {items.length} items
            </p>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#22C55E]" />
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E0E0E0] p-12 text-center">
            <Package className="w-16 h-16 text-[#D0D0D0] mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
              No saved items yet
            </h3>
            <p className="text-[#6B6B6B] mb-6" style={{ fontFamily: "Inter, sans-serif" }}>
              Add your first item to reuse it quickly when creating invoices
            </p>
            <button
              onClick={() => { setFormData({ description: "", unitPrice: 0 }); setShowAddModal(true); }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
            >
              <Plus className="w-5 h-5" />
              Add Your First Item
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E0E0E0] p-12 text-center">
            <Search className="w-16 h-16 text-[#D0D0D0] mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
              No matching items
            </h3>
            <p className="text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>
              Try adjusting your search criteria
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-[#E0E0E0] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-black text-white">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ fontFamily: "Manrope, sans-serif" }}>
                      Description
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ fontFamily: "Manrope, sans-serif" }}>
                      Unit Price
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ fontFamily: "Manrope, sans-serif" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, index) => (
                    <tr key={item.id} className={index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}>
                      <td className="px-6 py-4" style={{ fontFamily: "Inter, sans-serif" }}>
                        {editingItem?.id === item.id ? (
                          <input
                            type="text"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-3 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                            style={{ fontFamily: "Inter, sans-serif" }}
                          />
                        ) : (
                          <span className="font-medium">{item.description}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right" style={{ fontFamily: "Inter, sans-serif" }}>
                        {editingItem?.id === item.id ? (
                          <div className="flex justify-end">
                            <div className="relative w-32">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={formData.unitPrice}
                                onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                                className="w-full pl-7 pr-3 py-2 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                                style={{ fontFamily: "Inter, sans-serif" }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="font-medium">${item.unitPrice.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {editingItem?.id === item.id ? (
                            <>
                              <button onClick={handleUpdateItem} className="p-2 text-[#22C55E] hover:bg-[#F0FDF4] rounded-lg transition-colors cursor-pointer" title="Save">
                                <Save className="w-4 h-4" />
                              </button>
                              <button onClick={cancelEdit} className="p-2 text-[#6B6B6B] hover:bg-[#F5F5F5] rounded-lg transition-colors cursor-pointer" title="Cancel">
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(item)} className="p-2 text-[#6B6B6B] hover:bg-[#F5F5F5] rounded-lg transition-colors cursor-pointer" title="Edit">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteItem(item.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
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

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold" style={{ fontFamily: "Manrope, sans-serif" }}>
                Add New Item
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g. Web Development"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>
                  Unit Price
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6B6B]">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.unitPrice || ""}
                    onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                    style={{ fontFamily: "Inter, sans-serif" }}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2.5 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-colors cursor-pointer font-medium"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                className="flex-1 px-4 py-2.5 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer font-medium"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
