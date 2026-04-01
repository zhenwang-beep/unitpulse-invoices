import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAuth, optionalAuth } from "./auth-middleware.tsx";

const app = new Hono();

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// Ensure storage bucket exists
const BUCKET_NAME = "make-3c030652-company-logos";
const initStorage = async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(bucket => bucket.name === BUCKET_NAME);
    if (!bucketExists) {
      await supabase.storage.createBucket(BUCKET_NAME, {
        public: false,
        fileSizeLimit: 5242880, // 5MB
      });
      console.log(`Created bucket: ${BUCKET_NAME}`);
    }
  } catch (error) {
    console.error("Error initializing storage:", error);
  }
};
initStorage();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-3c030652/health", (c) => {
  return c.json({ status: "ok" });
});

// Get company settings
app.get("/make-server-3c030652/company-settings", async (c) => {
  try {
    const settings = await kv.get("company_settings");
    
    // If settings exist and include a logo path, generate a signed URL
    if (settings && settings.logoPath) {
      const { data: signedUrl } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(settings.logoPath, 3600); // 1 hour expiry
      
      if (signedUrl) {
        settings.logoUrl = signedUrl.signedUrl;
      }
    }
    
    return c.json({ settings: settings || null });
  } catch (error) {
    console.error("Error fetching company settings:", error);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
});

// Save company settings
app.post("/make-server-3c030652/company-settings", async (c) => {
  try {
    const body = await c.req.json();
    const { companyName, companyAddress, logoPath, companyEmail, companyPhone } = body;
    
    const settings = {
      companyName: companyName || "UnitPulse",
      companyAddress: companyAddress || "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
      logoPath: logoPath || null,
      companyEmail: companyEmail || "",
      companyPhone: companyPhone || "",
      updatedAt: new Date().toISOString(),
    };
    
    await kv.set("company_settings", settings);
    
    // Generate signed URL for the logo
    if (settings.logoPath) {
      const { data: signedUrl } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(settings.logoPath, 3600);
      
      if (signedUrl) {
        settings.logoUrl = signedUrl.signedUrl;
      }
    }
    
    return c.json({ settings });
  } catch (error) {
    console.error("Error saving company settings:", error);
    return c.json({ error: "Failed to save settings" }, 500);
  }
});

// Upload company logo
app.post("/make-server-3c030652/upload-logo", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("logo") as File;
    
    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }
    
    // Validate file type
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      return c.json({ error: "Invalid file type. Please upload PNG, JPG, or SVG." }, 400);
    }
    
    // Validate file size (5MB max)
    if (file.size > 5242880) {
      return c.json({ error: "File too large. Maximum size is 5MB." }, 400);
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const extension = file.name.split(".").pop();
    const filename = `logo-${timestamp}.${extension}`;
    
    // Convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      });
    
    if (uploadError) {
      console.error("Upload error:", uploadError);
      return c.json({ error: "Failed to upload logo" }, 500);
    }
    
    return c.json({ logoPath: uploadData.path });
  } catch (error) {
    console.error("Error uploading logo:", error);
    return c.json({ error: "Failed to upload logo" }, 500);
  }
});

// Get all saved items
app.get("/make-server-3c030652/items", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const items = await kv.getByPrefix(`user_${userId}_item_`);
    return c.json({ items: items || [] });
  } catch (error) {
    console.error("Error fetching items:", error);
    return c.json({ error: "Failed to fetch items" }, 500);
  }
});

// Save a new item
app.post("/make-server-3c030652/items", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { description, unitPrice } = body;
    
    if (!description || unitPrice === undefined) {
      return c.json({ error: "Description and unit price are required" }, 400);
    }
    
    // Generate unique ID for the item with user prefix
    const itemId = `user_${userId}_item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const item = {
      id: itemId,
      userId,
      description,
      unitPrice: parseFloat(unitPrice),
      createdAt: new Date().toISOString(),
    };
    
    await kv.set(itemId, item);
    
    return c.json({ item });
  } catch (error) {
    console.error("Error saving item:", error);
    return c.json({ error: "Failed to save item" }, 500);
  }
});

// Update an existing item
app.put("/make-server-3c030652/items/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const body = await c.req.json();
    const { description, unitPrice } = body;
    
    if (!description || unitPrice === undefined) {
      return c.json({ error: "Description and unit price are required" }, 400);
    }
    
    // Get existing item to preserve createdAt and verify ownership
    const existingItem = await kv.get(id);
    
    if (!existingItem) {
      return c.json({ error: "Item not found" }, 404);
    }
    
    // Verify user owns this item
    if (existingItem.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this item" }, 403);
    }
    
    const item = {
      id,
      userId,
      description,
      unitPrice: parseFloat(unitPrice),
      createdAt: existingItem.createdAt,
      updatedAt: new Date().toISOString(),
    };
    
    await kv.set(id, item);
    
    return c.json({ item });
  } catch (error) {
    console.error("Error updating item:", error);
    return c.json({ error: "Failed to update item" }, 500);
  }
});

// Delete an item
app.delete("/make-server-3c030652/items/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    
    const existingItem = await kv.get(id);
    
    if (!existingItem) {
      return c.json({ error: "Item not found" }, 404);
    }
    
    // Verify user owns this item
    if (existingItem.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this item" }, 403);
    }
    
    await kv.del(id);
    
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting item:", error);
    return c.json({ error: "Failed to delete item" }, 500);
  }
});

// Get all clients
app.get("/make-server-3c030652/clients", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const clients = await kv.getByPrefix(`user_${userId}_client_`);
    return c.json({ clients: clients || [] });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return c.json({ error: "Failed to fetch clients" }, 500);
  }
});

// Save a new client
app.post("/make-server-3c030652/clients", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { clientName, clientAddress, clientCity, clientState, clientZip, clientCountry } = body;
    
    if (!clientName) {
      return c.json({ error: "Client name is required" }, 400);
    }
    
    // Generate unique ID for the client with user prefix
    const clientId = `user_${userId}_client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const client = {
      id: clientId,
      userId,
      clientName,
      clientAddress: clientAddress || "",
      clientCity: clientCity || "",
      clientState: clientState || "CA",
      clientZip: clientZip || "",
      clientCountry: clientCountry || "United States",
      createdAt: new Date().toISOString(),
    };
    
    await kv.set(clientId, client);
    
    return c.json({ client });
  } catch (error) {
    console.error("Error saving client:", error);
    return c.json({ error: "Failed to save client" }, 500);
  }
});

// Update an existing client
app.put("/make-server-3c030652/clients/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const body = await c.req.json();
    const { clientName, clientAddress, clientCity, clientState, clientZip, clientCountry } = body;
    
    if (!clientName) {
      return c.json({ error: "Client name is required" }, 400);
    }
    
    // Get existing client to preserve createdAt and verify ownership
    const existingClient = await kv.get(id);
    
    if (!existingClient) {
      return c.json({ error: "Client not found" }, 404);
    }
    
    // Verify user owns this client
    if (existingClient.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this client" }, 403);
    }
    
    const client = {
      id,
      userId,
      clientName,
      clientAddress: clientAddress || "",
      clientCity: clientCity || "",
      clientState: clientState || "CA",
      clientZip: clientZip || "",
      clientCountry: clientCountry || "United States",
      createdAt: existingClient.createdAt,
      updatedAt: new Date().toISOString(),
    };
    
    await kv.set(id, client);
    
    return c.json({ client });
  } catch (error) {
    console.error("Error updating client:", error);
    return c.json({ error: "Failed to update client" }, 500);
  }
});

// Delete a client
app.delete("/make-server-3c030652/clients/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    
    const existingClient = await kv.get(id);
    
    if (!existingClient) {
      return c.json({ error: "Client not found" }, 404);
    }
    
    // Verify user owns this client
    if (existingClient.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this client" }, 403);
    }
    
    await kv.del(id);
    
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting client:", error);
    return c.json({ error: "Failed to delete client" }, 500);
  }
});

// Get all invoices
app.get("/make-server-3c030652/invoices", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const invoices = await kv.getByPrefix(`user_${userId}_invoice_`);
    // Sort by creation date, newest first
    const sortedInvoices = (invoices || []).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return c.json({ invoices: sortedInvoices });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return c.json({ error: "Failed to fetch invoices" }, 500);
  }
});

// Get a single invoice
app.get("/make-server-3c030652/invoices/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const invoice = await kv.get(id);
    
    if (!invoice) {
      return c.json({ error: "Invoice not found" }, 404);
    }
    
    // Verify user owns this invoice
    if (invoice.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this invoice" }, 403);
    }
    
    return c.json({ invoice });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    return c.json({ error: "Failed to fetch invoice" }, 500);
  }
});

// Save a new invoice
app.post("/make-server-3c030652/invoices", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { invoiceData, subtotal, tax, total } = body;
    
    if (!invoiceData) {
      return c.json({ error: "Invoice data is required" }, 400);
    }
    
    // Use invoice ID as the key with user prefix
    const invoiceId = `user_${userId}_invoice_${invoiceData.invoiceId}`;
    
    const invoice = {
      id: invoiceId,
      userId,
      createdByEmail: c.get("userEmail"),
      ...invoiceData,
      subtotal,
      tax,
      total,
      createdAt: new Date().toISOString(),
    };
    
    await kv.set(invoiceId, invoice);
    
    return c.json({ invoice });
  } catch (error) {
    console.error("Error saving invoice:", error);
    return c.json({ error: "Failed to save invoice" }, 500);
  }
});

// Update an existing invoice
app.put("/make-server-3c030652/invoices/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const body = await c.req.json();
    const { invoiceData, subtotal, tax, total } = body;
    
    if (!invoiceData) {
      return c.json({ error: "Invoice data is required" }, 400);
    }
    
    // Get existing invoice to preserve createdAt and verify ownership
    const existingInvoice = await kv.get(id);
    
    if (existingInvoice && existingInvoice.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this invoice" }, 403);
    }
    
    const invoice = {
      id,
      userId,
      ...invoiceData,
      subtotal,
      tax,
      total,
      createdAt: existingInvoice?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await kv.set(id, invoice);
    
    return c.json({ invoice });
  } catch (error) {
    console.error("Error updating invoice:", error);
    return c.json({ error: "Failed to update invoice" }, 500);
  }
});

// Delete an invoice
app.delete("/make-server-3c030652/invoices/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    
    const existingInvoice = await kv.get(id);
    
    if (!existingInvoice) {
      return c.json({ error: "Invoice not found" }, 404);
    }
    
    // Verify user owns this invoice
    if (existingInvoice.userId !== userId) {
      return c.json({ error: "Unauthorized - You don't own this invoice" }, 403);
    }
    
    await kv.del(id);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting invoice:", error);
    return c.json({ error: "Failed to delete invoice" }, 500);
  }
});

Deno.serve(app.fetch);