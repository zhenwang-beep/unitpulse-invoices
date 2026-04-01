import React, { useState, useEffect } from "react";
import { Users, Trash2, Edit, Search, Plus, X, Check } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Navbar } from "../components/Navbar";
import { fetchAPI } from "../utils/api";

interface Client {
  id: string;
  clientName: string;
  clientAddress: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  clientCountry: string;
  createdAt?: string;
  updatedAt?: string;
}

const emptyClient = {
  clientName: "",
  clientAddress: "",
  clientCity: "",
  clientState: "California",
  clientZip: "",
  clientCountry: "United States",
};

export default function ClientManagement() {
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClient, setNewClient] = useState<Omit<Client, "id">>(emptyClient);

  useEffect(() => { fetchClients(); }, []);
  useEffect(() => { filterClients(); }, [searchQuery, clients]);

  const fetchClients = async () => {
    try {
      const response = await fetchAPI("/clients");
      if (!response.ok) throw new Error("Failed to fetch clients");
      const data = await response.json();
      setClients(data.clients || []);
    } catch (error) {
      console.error("Error fetching clients:", error);
      toast.error("Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  const filterClients = () => {
    if (!searchQuery.trim()) {
      setFilteredClients(clients);
      return;
    }
    const query = searchQuery.toLowerCase();
    setFilteredClients(
      clients.filter(
        (c) =>
          c.clientName.toLowerCase().includes(query) ||
          c.clientAddress.toLowerCase().includes(query) ||
          c.clientCity.toLowerCase().includes(query)
      )
    );
  };

  const handleDeleteClient = async (id: string) => {
    if (!confirm("Are you sure you want to delete this client?")) return;
    try {
      const response = await fetchAPI(`/clients/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete client");
      toast.success("Client deleted successfully");
      fetchClients();
    } catch (error) {
      console.error("Error deleting client:", error);
      toast.error("Failed to delete client");
    }
  };

  const saveClient = async (client: Client) => {
    try {
      const response = await fetchAPI(`/clients/${client.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: client.clientName,
          clientAddress: client.clientAddress,
          clientCity: client.clientCity,
          clientState: client.clientState,
          clientZip: client.clientZip,
          clientCountry: client.clientCountry,
        }),
      });
      if (!response.ok) throw new Error("Failed to update client");
      toast.success("Client updated successfully");
      setEditingClient(null);
      fetchClients();
    } catch (error) {
      console.error("Error updating client:", error);
      toast.error("Failed to update client");
    }
  };

  const addNewClient = async () => {
    if (!newClient.clientName.trim()) {
      toast.error("Client name is required");
      return;
    }
    try {
      const response = await fetchAPI("/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClient),
      });
      if (!response.ok) throw new Error("Failed to add client");
      toast.success("Client added successfully");
      setShowAddModal(false);
      setNewClient(emptyClient);
      fetchClients();
    } catch (error) {
      console.error("Error adding client:", error);
      toast.error("Failed to add client");
    }
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
                Clients
              </h1>
              <p className="text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>
                View, search, and manage all your saved clients
              </p>
            </div>
            <button
              onClick={() => { setNewClient(emptyClient); setShowAddModal(true); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Client</span>
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
                placeholder="Search by name, address, or city..."
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
              Showing {filteredClients.length} of {clients.length} clients
            </p>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#22C55E]" />
          </div>
        ) : clients.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E0E0E0] p-12 text-center">
            <Users className="w-16 h-16 text-[#D0D0D0] mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
              No clients yet
            </h3>
            <p className="text-[#6B6B6B] mb-6" style={{ fontFamily: "Inter, sans-serif" }}>
              Add your first client to get started
            </p>
            <button
              onClick={() => { setNewClient(emptyClient); setShowAddModal(true); }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
            >
              <Plus className="w-5 h-5" />
              Add Client
            </button>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E0E0E0] p-12 text-center">
            <Search className="w-16 h-16 text-[#D0D0D0] mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: "Manrope, sans-serif" }}>
              No matching clients
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
                    {["Client Name", "Address", "City", "State", "Zip", "Actions"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-6 py-3 text-xs font-semibold uppercase tracking-wider ${i === 5 ? "text-right" : "text-left"}`}
                        style={{ fontFamily: "Manrope, sans-serif" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client, index) => (
                    <tr key={client.id} className={index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}>
                      {editingClient?.id === client.id ? (
                        <>
                          {(["clientName", "clientAddress", "clientCity", "clientState", "clientZip"] as (keyof Client)[]).map((field) => (
                            <td key={field} className="px-6 py-4">
                              <input
                                type="text"
                                value={editingClient[field] as string}
                                onChange={(e) => setEditingClient({ ...editingClient, [field]: e.target.value })}
                                className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                                style={{ fontFamily: "Inter, sans-serif" }}
                              />
                            </td>
                          ))}
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => saveClient(editingClient)} className="p-2 text-[#22C55E] hover:bg-[#F0FDF4] rounded transition-colors cursor-pointer" title="Save">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingClient(null)} className="p-2 text-[#6B6B6B] hover:bg-[#F5F5F5] rounded transition-colors cursor-pointer" title="Cancel">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 font-medium text-sm" style={{ fontFamily: "Inter, sans-serif" }}>{client.clientName}</td>
                          <td className="px-6 py-4 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>{client.clientAddress || "—"}</td>
                          <td className="px-6 py-4 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>{client.clientCity || "—"}</td>
                          <td className="px-6 py-4 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>{client.clientState || "—"}</td>
                          <td className="px-6 py-4 text-sm text-[#6B6B6B]" style={{ fontFamily: "Inter, sans-serif" }}>{client.clientZip || "—"}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => setEditingClient({ ...client })} className="p-2 text-[#6B6B6B] hover:text-[#22C55E] hover:bg-[#F0FDF4] rounded transition-colors cursor-pointer" title="Edit">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteClient(client.id)} className="p-2 text-[#6B6B6B] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold" style={{ fontFamily: "Manrope, sans-serif" }}>
                Add New Client
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>
                  Client Name *
                </label>
                <input
                  type="text"
                  value={newClient.clientName}
                  onChange={(e) => setNewClient({ ...newClient, clientName: e.target.value })}
                  placeholder="e.g. Acme Corp"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                  autoFocus
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>Address</label>
                <input
                  type="text"
                  value={newClient.clientAddress}
                  onChange={(e) => setNewClient({ ...newClient, clientAddress: e.target.value })}
                  placeholder="Street address"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>City</label>
                <input
                  type="text"
                  value={newClient.clientCity}
                  onChange={(e) => setNewClient({ ...newClient, clientCity: e.target.value })}
                  placeholder="City"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>State</label>
                <input
                  type="text"
                  value={newClient.clientState}
                  onChange={(e) => setNewClient({ ...newClient, clientState: e.target.value })}
                  placeholder="State"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>Zip Code</label>
                <input
                  type="text"
                  value={newClient.clientZip}
                  onChange={(e) => setNewClient({ ...newClient, clientZip: e.target.value })}
                  placeholder="Zip"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label className="block text-sm text-[#6B6B6B] mb-1.5" style={{ fontFamily: "Manrope, sans-serif" }}>Country</label>
                <input
                  type="text"
                  value={newClient.clientCountry}
                  onChange={(e) => setNewClient({ ...newClient, clientCountry: e.target.value })}
                  placeholder="Country"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
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
                onClick={addNewClient}
                className="flex-1 px-4 py-2.5 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer font-medium"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Add Client
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
