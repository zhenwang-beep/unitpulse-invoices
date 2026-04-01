import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Users,
  Trash2,
  Edit,
  ArrowLeft,
  Search,
  Plus,
  X,
  Save,
  Check,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { projectId } from "/utils/supabase/info";
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

export default function ClientManagement() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newClient, setNewClient] = useState<Omit<Client, "id">>({
    clientName: "",
    clientAddress: "",
    clientCity: "",
    clientState: "California",
    clientZip: "",
    clientCountry: "United States",
  });

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    filterClients();
  }, [searchQuery, clients]);

  const fetchClients = async () => {
    try {
      const response = await fetchAPI("/clients");

      if (!response.ok) {
        throw new Error("Failed to fetch clients");
      }

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
    let filtered = [...clients];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (client) =>
          client.clientName.toLowerCase().includes(query) ||
          client.clientAddress.toLowerCase().includes(query) ||
          client.clientCity.toLowerCase().includes(query)
      );
    }

    setFilteredClients(filtered);
  };

  const handleDeleteClient = async (id: string) => {
    if (!confirm("Are you sure you want to delete this client?")) {
      return;
    }

    try {
      const response = await fetchAPI(`/clients/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete client");
      }

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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientName: client.clientName,
          clientAddress: client.clientAddress,
          clientCity: client.clientCity,
          clientState: client.clientState,
          clientZip: client.clientZip,
          clientCountry: client.clientCountry,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update client");
      }

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

    const formData = {
      clientName: newClient.clientName,
      clientAddress: newClient.clientAddress,
      clientCity: newClient.clientCity,
      clientState: newClient.clientState,
      clientZip: newClient.clientZip,
      clientCountry: newClient.clientCountry,
    };

    try {
      const response = await fetchAPI("/clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to add client");
      }

      toast.success("Client added successfully");
      setIsAddingNew(false);
      setNewClient({
        clientName: "",
        clientAddress: "",
        clientCity: "",
        clientState: "California",
        clientZip: "",
        clientCountry: "United States",
      });
      fetchClients();
    } catch (error) {
      console.error("Error adding client:", error);
      toast.error("Failed to add client");
    }
  };

  const startEditing = (client: Client) => {
    setEditingClient({ ...client });
  };

  const cancelEditing = () => {
    setEditingClient(null);
  };

  const updateEditingClient = (field: keyof Client, value: string) => {
    if (editingClient) {
      setEditingClient({ ...editingClient, [field]: value });
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Toaster position="top-center" />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1
                className="text-4xl font-bold mb-2"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                Client Management
              </h1>
              <p
                className="text-[#6B6B6B]"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                View, search, and manage all your saved clients
              </p>
            </div>
            <button
              onClick={() => setIsAddingNew(true)}
              className="flex items-center gap-2 px-6 py-3 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}
            >
              <Plus className="w-5 h-5" />
              Add Client
            </button>
          </div>

          {/* Search Bar */}
          <div className="flex items-center gap-4 mt-6">
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
                title="Clear search"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {searchQuery && (
            <p
              className="mt-4 text-sm text-[#6B6B6B]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Showing {filteredClients.length} of {clients.length} clients
            </p>
          )}
        </div>

        {/* Add New Client Form */}
        {isAddingNew && (
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-6">
            <h3
              className="text-xl font-semibold mb-4"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Add New Client
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm text-[#6B6B6B] mb-1.5"
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  Client Name *
                </label>
                <input
                  type="text"
                  value={newClient.clientName}
                  onChange={(e) =>
                    setNewClient({ ...newClient, clientName: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label
                  className="block text-sm text-[#6B6B6B] mb-1.5"
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  Address
                </label>
                <input
                  type="text"
                  value={newClient.clientAddress}
                  onChange={(e) =>
                    setNewClient({ ...newClient, clientAddress: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label
                  className="block text-sm text-[#6B6B6B] mb-1.5"
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  City
                </label>
                <input
                  type="text"
                  value={newClient.clientCity}
                  onChange={(e) =>
                    setNewClient({ ...newClient, clientCity: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label
                  className="block text-sm text-[#6B6B6B] mb-1.5"
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  State
                </label>
                <input
                  type="text"
                  value={newClient.clientState}
                  onChange={(e) =>
                    setNewClient({ ...newClient, clientState: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label
                  className="block text-sm text-[#6B6B6B] mb-1.5"
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  Zip Code
                </label>
                <input
                  type="text"
                  value={newClient.clientZip}
                  onChange={(e) =>
                    setNewClient({ ...newClient, clientZip: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
              <div>
                <label
                  className="block text-sm text-[#6B6B6B] mb-1.5"
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  Country
                </label>
                <input
                  type="text"
                  value={newClient.clientCountry}
                  onChange={(e) =>
                    setNewClient({ ...newClient, clientCountry: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:border-transparent"
                  style={{ fontFamily: "Inter, sans-serif" }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={addNewClient}
                className="flex items-center gap-2 px-4 py-2 bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
                style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
              >
                <Check className="w-4 h-4" />
                Save Client
              </button>
              <button
                onClick={() => {
                  setIsAddingNew(false);
                  setNewClient({
                    clientName: "",
                    clientAddress: "",
                    clientCity: "",
                    clientState: "California",
                    clientZip: "",
                    clientCountry: "United States",
                  });
                }}
                className="px-4 py-2 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition-colors cursor-pointer"
                style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Client List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#22C55E]"></div>
          </div>
        ) : clients.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 text-center">
            <Users className="w-16 h-16 text-[#6B6B6B] mx-auto mb-4" />
            <h3
              className="text-xl font-semibold mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              No clients yet
            </h3>
            <p
              className="text-[#6B6B6B] mb-6"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Add your first client to see them here
            </p>
            <button
              onClick={() => setIsAddingNew(true)}
              className="bg-[#22C55E] text-white px-6 py-2 rounded-lg hover:bg-[#16A34A] transition-colors cursor-pointer"
              style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
            >
              Add Client
            </button>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 text-center">
            <Search className="w-16 h-16 text-[#6B6B6B] mx-auto mb-4" />
            <h3
              className="text-xl font-semibold mb-2"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              No matching clients
            </h3>
            <p
              className="text-[#6B6B6B] mb-6"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Try adjusting your search criteria
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
                      Client Name
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Address
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      City
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      State
                    </th>
                    <th
                      className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "Manrope, sans-serif" }}
                    >
                      Zip
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
                  {filteredClients.map((client, index) => (
                    <tr
                      key={client.id}
                      className={index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}
                    >
                      {editingClient?.id === client.id ? (
                        <>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingClient.clientName}
                              onChange={(e) =>
                                updateEditingClient("clientName", e.target.value)
                              }
                              className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                              style={{ fontFamily: "Inter, sans-serif" }}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingClient.clientAddress}
                              onChange={(e) =>
                                updateEditingClient("clientAddress", e.target.value)
                              }
                              className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                              style={{ fontFamily: "Inter, sans-serif" }}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingClient.clientCity}
                              onChange={(e) =>
                                updateEditingClient("clientCity", e.target.value)
                              }
                              className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                              style={{ fontFamily: "Inter, sans-serif" }}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingClient.clientState}
                              onChange={(e) =>
                                updateEditingClient("clientState", e.target.value)
                              }
                              className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                              style={{ fontFamily: "Inter, sans-serif" }}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingClient.clientZip}
                              onChange={(e) =>
                                updateEditingClient("clientZip", e.target.value)
                              }
                              className="w-full px-3 py-1.5 border border-[#E0E0E0] rounded focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
                              style={{ fontFamily: "Inter, sans-serif" }}
                            />
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => saveClient(editingClient)}
                                className="p-2 text-[#22C55E] hover:bg-[#F0FDF4] rounded transition-colors cursor-pointer"
                                title="Save"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="p-2 text-[#6B6B6B] hover:bg-[#F5F5F5] rounded transition-colors cursor-pointer"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td
                            className="px-6 py-4 font-medium"
                            style={{ fontFamily: "Inter, sans-serif" }}
                          >
                            {client.clientName}
                          </td>
                          <td
                            className="px-6 py-4"
                            style={{ fontFamily: "Inter, sans-serif" }}
                          >
                            {client.clientAddress || "—"}
                          </td>
                          <td
                            className="px-6 py-4 text-[#6B6B6B]"
                            style={{ fontFamily: "Inter, sans-serif" }}
                          >
                            {client.clientCity || "—"}
                          </td>
                          <td
                            className="px-6 py-4 text-[#6B6B6B]"
                            style={{ fontFamily: "Inter, sans-serif" }}
                          >
                            {client.clientState || "—"}
                          </td>
                          <td
                            className="px-6 py-4 text-[#6B6B6B]"
                            style={{ fontFamily: "Inter, sans-serif" }}
                          >
                            {client.clientZip || "—"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => startEditing(client)}
                                className="p-2 text-[#6B6B6B] hover:text-[#22C55E] hover:bg-[#F0FDF4] rounded transition-colors cursor-pointer"
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteClient(client.id)}
                                className="p-2 text-[#6B6B6B] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="Delete"
                              >
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
    </div>
  );
}