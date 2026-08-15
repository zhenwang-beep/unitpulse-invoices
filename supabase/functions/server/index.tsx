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
    // PATCH is here for /quotes/:id/status. A status change is a partial
    // update, and PATCH is not a CORS-safelisted method, so leaving it out of
    // this list makes the browser fail the preflight and the route becomes
    // unreachable from the app however correct the handler is.
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-3c030652/health", (c) => {
  return c.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// Company settings defaults.
//
// The edge function cannot import from src/, so DEFAULT_QUOTE_DEFAULTS is
// transcribed here from src/app/types/quote.ts. Keep the two in sync — this is
// the fallback a new account inherits before it has saved any quote
// boilerplate of its own.
// ---------------------------------------------------------------------------

const DEFAULT_COMPANY_SETTINGS = {
  companyName: "UnitPulse",
  companyAddress: "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States",
  logoPath: null,
  companyEmail: "",
  companyPhone: "",
};

const DEFAULT_QUOTE_DEFAULTS = {
  serviceLine: "GoAiden by UnitPulse  ·  AI marketing & content engagement",
  issuerName: "",
  issuerEmail: "",
  issuerPhone: "",
  validityDays: 30,
  initialTermMonths: 3,
  renewalTerms: "Auto-renews month-to-month at the end of the initial term",
  cancellationTerms:
    "30 days' written notice, effective at the end of the then-current billing month",
  billingCadence: "Monthly in advance, invoiced on the 1st of each month",
  paymentTerms: "Net 30 from invoice date, by ACH / check / card",
  priceChangeTerms:
    "Fixed for the initial term; any change thereafter requires 30 days' notice",
  quoteValidityTerms: "30 days from the quote date shown above",
  scopeGroups: [
    {
      id: "scope-search",
      title: "Search & AI visibility",
      category: "SEO / GEO",
      bullets: [
        "Full SEO and GEO assessment of the property's web presence",
        "Local search optimization recommendations, prioritized by expected lift",
        "Visibility monitoring across AI answer engines and traditional search",
      ],
    },
    {
      id: "scope-strategy",
      title: "Marketing strategy",
      category: "Planning",
      bullets: [
        "Custom strategy built to the property's demographics and lease-up stage",
        "Monthly plan review with recommendations drawn from the property's own data",
      ],
    },
    {
      id: "scope-content",
      title: "Content production",
      category: "Creative",
      bullets: [
        "Image editing and retouching of property photography",
        "Poster and flyer design for on-site and digital placement",
        "Copywriting for listings, ads, and social captions",
        "Short-form video creation",
      ],
    },
    {
      id: "scope-social",
      title: "Social management",
      category: "Distribution",
      bullets: [
        "End-to-end management of connected social accounts",
        "Regular scheduled posting on an agreed cadence",
      ],
    },
  ],
  included: [
    "Onboarding and account connection setup",
    "All content production described in Section 02",
    "Monthly performance reporting",
    "Email support with 1 business day response",
  ],
  excluded: [
    "Paid media spend (billed directly by the ad platform)",
    "Professional photography or videography shoots on site",
    "Website development or hosting",
    "Third-party licensing, stock media, or listing-syndication fees",
  ],
  assumptionsNote:
    "This quote assumes the client provides administrative access to the property's social, Google Business, and listing accounts within 5 business days of signature. Delays in access shift the service start date without changing the fee.",
};

// Stored defaults win field by field; anything absent falls back to the
// transcribed template. The three list fields are checked explicitly so a
// malformed stored value can never hand the quote editor a non-array.
const mergeQuoteDefaults = (stored: any) => {
  const s = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULT_QUOTE_DEFAULTS,
    ...s,
    scopeGroups: Array.isArray(s.scopeGroups)
      ? s.scopeGroups
      : DEFAULT_QUOTE_DEFAULTS.scopeGroups,
    included: Array.isArray(s.included) ? s.included : DEFAULT_QUOTE_DEFAULTS.included,
    excluded: Array.isArray(s.excluded) ? s.excluded : DEFAULT_QUOTE_DEFAULTS.excluded,
  };
};

// Get company settings
app.get("/make-server-3c030652/company-settings", requireAuth, async (c) => {
  try {
    const stored = await kv.get("company_settings");

    const settings: Record<string, any> = {
      ...DEFAULT_COMPANY_SETTINGS,
      ...(stored || {}),
      quoteDefaults: mergeQuoteDefaults(stored?.quoteDefaults),
    };

    // If settings include a logo path, generate a signed URL
    if (settings.logoPath) {
      const { data: signedUrl } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(settings.logoPath, 3600); // 1 hour expiry

      if (signedUrl) {
        settings.logoUrl = signedUrl.signedUrl;
      }
    }

    return c.json({ settings });
  } catch (error) {
    console.error("Error fetching company settings:", error);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
});

// Save company settings
// requireAuth: these settings now carry quoteDefaults, the boilerplate every
// future quote inherits. An unauthenticated write would let anyone rewrite it.
app.post("/make-server-3c030652/company-settings", requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { companyName, companyAddress, logoPath, companyEmail, companyPhone } = body;

    // A caller may send only the company fields (the settings page) or only
    // quoteDefaults (the quote defaults editor). Each field is written only
    // when its key is present, so neither caller clobbers the other's data.
    const existing = (await kv.get("company_settings")) || {};
    const sent = (key: string) => body && typeof body === "object" && key in body;

    const settings: Record<string, any> = {
      ...existing,
      companyName: sent("companyName")
        ? companyName || DEFAULT_COMPANY_SETTINGS.companyName
        : existing.companyName || DEFAULT_COMPANY_SETTINGS.companyName,
      companyAddress: sent("companyAddress")
        ? companyAddress || DEFAULT_COMPANY_SETTINGS.companyAddress
        : existing.companyAddress || DEFAULT_COMPANY_SETTINGS.companyAddress,
      logoPath: sent("logoPath") ? logoPath || null : existing.logoPath || null,
      companyEmail: sent("companyEmail") ? companyEmail || "" : existing.companyEmail || "",
      companyPhone: sent("companyPhone") ? companyPhone || "" : existing.companyPhone || "",
      updatedAt: new Date().toISOString(),
    };

    // Quote boilerplate is patched, not replaced: a body carrying one changed
    // field must not blank the rest.
    if (sent("quoteDefaults")) {
      settings.quoteDefaults = mergeQuoteDefaults({
        ...(existing.quoteDefaults || {}),
        ...(body.quoteDefaults || {}),
      });
    }

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
      createdByEmail: existingInvoice?.createdByEmail || c.get("userEmail"),
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

// ===========================================================================
// Service quotes
//
// Invoices are opaque JSON blobs in the kv store. Quotes are not: they live in
// public.quotes and public.quote_line_items, created by
// supabase/migrations/20260814000000_create_service_quotes.sql.
//
// Two invariants hold across every handler below:
//   1. user_id comes from the verified JWT, never from the request body, and
//      every by-id query filters on BOTH id AND user_id, so one account can
//      never read or mutate another's quote. Nothing matched means 404.
//   2. Writes go through public.save_quote and nowhere else. That function
//      saves the parent row, replaces the line items and sums the totals in a
//      single transaction, so a failed line-item write can never leave a quote
//      whose previous items were already deleted. It also owns the money: a
//      client-sent subtotal or total is ignored in favour of a Postgres
//      numeric sum of the rows actually stored, which is the arithmetic the
//      generated `amount` column uses too.
//
// Validation still lives here — the messages have to name the offending field
// for the person filling in the form. Only the write moved to the database.
// ===========================================================================

// What a status can be STORED as. "expired" is deliberately absent: the
// 20260816 migration dropped it from quotes_status_check, so it is a displayed
// value derived from valid_until. Accepting it here would let a save reach
// Postgres only to be refused by the CHECK constraint, which surfaces as an
// unexplained 500 instead of a message naming the field.
const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined"];

// Quote plus its line items in one round trip, so the list page never has to
// fetch items per row.
const QUOTE_SELECT = "*, quote_line_items(*)";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// JSON hands numbers over as either numbers or strings; this is the single
// coercion used by validation and by the RPC payload.
//
// Nothing here rounds or sums money. save_quote does that in Postgres numeric,
// and JavaScript's binary floating point disagrees with it: 0.01 * 14.50 is
// 0.145 in JS, which rounds to 0.14, while numeric rounds the same product to
// 0.15. Rounding here first would have made the stored subtotal differ from
// the generated `amount` column by a cent.
const num = (v: any): number =>
  v === null || v === undefined || v === "" ? 0 : Number(v);

const text = (v: any): string => (v === null || v === undefined ? "" : String(v));

const asArray = (v: any): any[] => (Array.isArray(v) ? v : []);

// yyyy-mm-dd, and a real calendar day — "2026-02-31" matches the shape but is
// not a date.
const isISODate = (v: any): boolean => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

// Postgres cannot cast "" to date; an unset optional date must be null.
const dateOrNull = (v: any): string | null => (isISODate(v) ? v : null);

// Expiry is derived from valid_until, never stored — storing 'expired' would
// give two sources of truth that drift the moment a date passes with no job
// running. This is the JS twin of public.quote_effective_status in the
// migration, and the single definition used by every read path here.
const todayISO = (): string => new Date().toISOString().slice(0, 10);

const effectiveQuoteStatus = (status: any, validUntil: any): string => {
  const current = text(status) || "draft";
  const until = text(validUntil);
  return (current === "draft" || current === "sent") &&
    isISODate(until) &&
    until < todayISO()
    ? "expired"
    : current;
};

// quotes_term_positive allows NULL or a positive integer, so 0, "" and
// negatives all mean "no fixed term".
const initialTermOrNull = (v: any): number | null => {
  const n = Math.round(num(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// save_quote reports both of its expected failures as SQLSTATEs, which
// PostgREST passes through as error.code.
//
// The UNIQUE (user_id, quote_number) constraint surfaces as Postgres 23505.
const isDuplicateQuoteNumber = (error: any): boolean => error?.code === "23505";

// save_quote raises P0002 when the id it was asked to update is not owned by
// the caller — the same "nothing matched means 404" rule the read paths use.
const isMissingQuote = (error: any): boolean => error?.code === "P0002";

/**
 * The quote editor posts the document wrapped as { quote }, the same shape the
 * invoice routes above use for { invoiceData }. A bare document body is
 * accepted too, so the endpoint does not depend on which of the two shapes a
 * caller happens to send.
 */
const readQuoteBody = (raw: any): any =>
  raw && typeof raw === "object" && raw.quote && typeof raw.quote === "object"
    ? raw.quote
    : raw;

/**
 * Returns a specific message when the payload cannot be stored, or null when
 * it can. Every branch names the offending field and the value it saw — a bare
 * "invalid" tells the person filling in the form nothing.
 */
const validateQuoteBody = (body: any): string | null => {
  if (!body || typeof body !== "object") return "A quote object is required.";

  // An empty quote number is legal: save_quote allocates the next one for
  // this user and year and retries on collision. Only a number the user
  // actually typed is held to uniqueness.

  const status = text(body.status) || "draft";
  if (!QUOTE_STATUSES.includes(status)) {
    return `Status "${status}" is not allowed. Use one of: ${QUOTE_STATUSES.join(", ")}.`;
  }

  if (!isISODate(body.quoteDate)) {
    return `Quote date "${text(body.quoteDate)}" is not a valid date. Use YYYY-MM-DD.`;
  }
  if (!isISODate(body.validUntil)) {
    return `Valid until "${text(body.validUntil)}" is not a valid date. Use YYYY-MM-DD.`;
  }
  // Both are zero-padded yyyy-mm-dd, so a string compare is a date compare.
  if (body.validUntil < body.quoteDate) {
    return `Valid until (${body.validUntil}) cannot be earlier than the quote date (${body.quoteDate}).`;
  }
  if (text(body.serviceStartDate).trim() && !isISODate(body.serviceStartDate)) {
    return `Service start date "${text(body.serviceStartDate)}" is not a valid date. Use YYYY-MM-DD.`;
  }

  if (body.lineItems !== undefined && !Array.isArray(body.lineItems)) {
    return "Line items must be an array.";
  }
  const items = asArray(body.lineItems);
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const label = text(item.serviceName).trim() || `line ${i + 1}`;
    const quantity = num(item.quantity);
    const unitPrice = num(item.unitPrice);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return `Quantity for "${label}" must be a number of 0 or more.`;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return `Unit price for "${label}" must be an amount of 0 or more.`;
    }
    // Mirror the CHECK constraints on quote_line_items. Without these the
    // database raises and the caller sees an opaque 500 instead of being told
    // which field is out of range.
    if (quantity > 100000) {
      return `Quantity for "${label}" must be 100000 or less.`;
    }
    if (unitPrice > 1000000) {
      return `Unit price for "${label}" must be 1000000 or less.`;
    }
  }
  if (items.length > 200) {
    return "A quote cannot have more than 200 line items.";
  }
  // Prose fields are rendered directly into the document and the PDF; a null or
  // non-object entry crashes the renderer, so the shape is checked here rather
  // than only that the field is an array.
  for (const group of asArray(body.scopeGroups)) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      return "Each scope group must be an object.";
    }
    for (const field of ["id", "title", "category"] as const) {
      const value = (group as any)[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        return `Scope group ${field} must be text.`;
      }
    }
    if ((group as any).bullets !== undefined && !Array.isArray((group as any).bullets)) {
      return "Scope group bullets must be an array of strings.";
    }
    for (const bullet of asArray((group as any).bullets)) {
      if (typeof bullet !== "string") return "Scope group bullets must be strings.";
    }
  }
  for (const key of ["included", "excluded"] as const) {
    for (const entry of asArray((body as any)[key])) {
      if (typeof entry !== "string") return `Every ${key} entry must be a string.`;
    }
  }

  const setupFee = num(body.setupFee);
  if (!Number.isFinite(setupFee) || setupFee < 0) {
    return "One-time setup fee must be an amount of 0 or more.";
  }

  for (const key of ["scopeGroups", "included", "excluded"]) {
    if (body[key] !== undefined && !Array.isArray(body[key])) {
      return `${key} must be an array.`;
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// The one place quote field names are translated. camelCase is the TS side
// (src/app/types/quote.ts); snake_case is Postgres.
//
// user_id and created_by_email are deliberately absent from quoteToRow:
// ownership is stamped from the JWT at the call site so a body can never
// claim it. subtotal and total_monthly are absent for the same reason —
// save_quote sums them from the line items it is storing.
// ---------------------------------------------------------------------------

const quoteToRow = (body: any) => ({
  quote_number: text(body.quoteNumber).trim(),
  status: text(body.status) || "draft",

  // Issued to
  client_name: text(body.clientName),
  client_contact_name: text(body.clientContactName),
  client_contact_title: text(body.clientContactTitle),
  client_email: text(body.clientEmail),
  client_phone: text(body.clientPhone),
  client_address: text(body.clientAddress),

  // Issued by
  issuer_name: text(body.issuerName),
  issuer_email: text(body.issuerEmail),
  issuer_phone: text(body.issuerPhone),

  // Dark header band
  service_line: text(body.serviceLine),
  prepared_for_address: text(body.preparedForAddress),

  quote_date: body.quoteDate,
  valid_until: body.validUntil,
  service_start_date: dateOrNull(body.serviceStartDate),

  // Section 03
  initial_term_months: initialTermOrNull(body.initialTermMonths),
  renewal_terms: text(body.renewalTerms),
  cancellation_terms: text(body.cancellationTerms),
  billing_cadence: text(body.billingCadence),
  payment_terms: text(body.paymentTerms),
  price_change_terms: text(body.priceChangeTerms),
  quote_validity_terms: text(body.quoteValidityTerms),

  // Section 01. The one-time fee is a stated amount, so it comes from the body
  // (validated non-negative above and rounded by save_quote); subtotal and
  // total_monthly are derived and are not sent at all.
  currency: text(body.currency).trim() || "USD",
  setup_fee: num(body.setupFee),

  // Sections 02 & 04
  scope_groups: asArray(body.scopeGroups),
  included: asArray(body.included),
  excluded: asArray(body.excluded),
  assumptions_note: text(body.assumptionsNote),
  notes: text(body.notes),
});

const rowToLineItem = (row: any) => ({
  id: row.id,
  position: Number(row.position) || 0,
  serviceName: row.service_name ?? "",
  description: row.description ?? "",
  quantity: Number(row.quantity) || 0,
  unitPrice: Number(row.unit_price) || 0,
  // Generated column — the line total can never drift from its inputs.
  amount: Number(row.amount) || 0,
});

const rowToQuote = (row: any) => ({
  id: row.id,
  userId: row.user_id,
  createdByEmail: row.created_by_email ?? "",

  quoteNumber: row.quote_number,
  status: row.status,
  // Derived, never stored. save_quote returns it precomputed; the read paths
  // fall back to the identical rule in effectiveQuoteStatus.
  effectiveStatus:
    text(row.effective_status) ||
    effectiveQuoteStatus(row.status, row.valid_until),

  clientName: row.client_name ?? "",
  clientContactName: row.client_contact_name ?? "",
  clientContactTitle: row.client_contact_title ?? "",
  clientEmail: row.client_email ?? "",
  clientPhone: row.client_phone ?? "",
  clientAddress: row.client_address ?? "",

  issuerName: row.issuer_name ?? "",
  issuerEmail: row.issuer_email ?? "",
  issuerPhone: row.issuer_phone ?? "",

  serviceLine: row.service_line ?? "",
  preparedForAddress: row.prepared_for_address ?? "",

  quoteDate: row.quote_date ?? "",
  validUntil: row.valid_until ?? "",
  serviceStartDate: row.service_start_date ?? "",

  initialTermMonths:
    row.initial_term_months === null || row.initial_term_months === undefined
      ? null
      : Number(row.initial_term_months),
  renewalTerms: row.renewal_terms ?? "",
  cancellationTerms: row.cancellation_terms ?? "",
  billingCadence: row.billing_cadence ?? "",
  paymentTerms: row.payment_terms ?? "",
  priceChangeTerms: row.price_change_terms ?? "",
  quoteValidityTerms: row.quote_validity_terms ?? "",

  currency: row.currency ?? "USD",
  // Two shapes reach this mapper: the PostgREST embed nests the items under
  // quote_line_items, save_quote returns them under line_items. The rows
  // themselves are identical either way.
  //
  // Sorted here rather than in the query so the order does not depend on the
  // embedded-resource ordering syntax of a particular client version.
  lineItems: asArray(row.quote_line_items ?? row.line_items)
    .slice()
    .sort((a: any, b: any) => (Number(a?.position) || 0) - (Number(b?.position) || 0))
    .map(rowToLineItem),
  setupFee: Number(row.setup_fee) || 0,
  // Echoed from the stored, server-computed columns. The client can derive
  // these from lineItems, but the list page should not have to.
  subtotal: Number(row.subtotal) || 0,
  totalMonthly: Number(row.total_monthly) || 0,
  // The generated column. Without it the client recomputes "due at signing"
  // in JS and can land a cent away from the stored figure.
  initialAmountDue: Number(row.initial_amount_due) || 0,

  scopeGroups: asArray(row.scope_groups),
  included: asArray(row.included),
  excluded: asArray(row.excluded),
  assumptionsNote: row.assumptions_note ?? "",
  notes: row.notes ?? "",

  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// The line items as save_quote wants them.
//
// quote_id and position are omitted: the function fills both in, taking
// position from the array's ordinality, so a reordered list still round-trips
// in the order the user left it. id is omitted too — the column is a uuid with
// a default, and the client's newId() values are not uuids.
const quoteItemsToJson = (items: any[]) =>
  items.map((item) => ({
    service_name: text(item?.serviceName),
    description: text(item?.description),
    quantity: num(item?.quantity),
    unit_price: num(item?.unitPrice),
  }));

/**
 * The single write path for a quote and its lines.
 *
 * p_quote_id is null to create and the row id to update. On an update the
 * function itself checks ownership and raises P0002 when the id belongs to
 * someone else, so there is no separate lookup to race against.
 */
const saveQuote = async (
  userId: string,
  email: any,
  body: any,
  quoteId: string | null,
) =>
  await supabase.rpc("save_quote", {
    p_user_id: userId,
    p_email: email ?? null,
    p_quote: quoteToRow(body),
    p_items: quoteItemsToJson(asArray(body.lineItems)),
    p_quote_id: quoteId,
  });

/**
 * Turns a save_quote failure into the status and message to send back. The two
 * expected SQLSTATEs get specific answers; anything else is a real fault, so
 * its message is logged and the caller is told only that the save failed.
 */
const saveQuoteFailure = (
  error: any,
  quoteNumber: string,
  failureMessage: string,
): { body: { error: string }; status: 404 | 409 | 500 } => {
  if (isDuplicateQuoteNumber(error)) {
    return {
      body: {
        error: `Quote number ${quoteNumber} is already in use. Choose a different number.`,
      },
      status: 409,
    };
  }
  if (isMissingQuote(error)) {
    return { body: { error: "Quote not found" }, status: 404 };
  }
  console.error(
    `${failureMessage}:`,
    error?.message ?? error ?? "save_quote returned no row",
  );
  return { body: { error: failureMessage }, status: 500 };
};

// Get all quotes, newest first, each with its line items
// The number a save would assign, so the editor can show it instead of a vague
// "assigned later". Registered BEFORE /quotes/:id or that route would swallow
// "next-number" as an id. It is a preview only — save_quote still allocates
// authoritatively, and this can legitimately go stale if another quote is
// created first.
app.get("/make-server-3c030652/quotes/next-number", requireAuth, async (c) => {
  try {
    const { data, error } = await supabase.rpc("next_quote_number", {
      p_user_id: c.get("userId"),
    });
    if (error) {
      console.error("Error previewing quote number:", error.message);
      return c.json({ nextNumber: null });
    }
    return c.json({ nextNumber: data ?? null });
  } catch (error) {
    console.error("Error previewing quote number:", error);
    return c.json({ nextNumber: null });
  }
});

// ---------------------------------------------------------------------------
// Quote lifecycle and invoicing.
//
// Both live in Postgres (20260816000000_quote_status_and_invoicing.sql), and
// deliberately not in save_quote: clicking a status chip must not rewrite the
// commercial content of the document, and creating an invoice has to write the
// invoice blob and its link in one transaction or a link can end up pointing at
// nothing. So these three handlers validate the request, call the function, and
// translate its SQLSTATEs. They own no billing rule of their own, and they never
// write an invoice through the kv helper.
//
// Registered before /quotes/:id for the same reason /quotes/next-number is.
// ---------------------------------------------------------------------------

// What a status can be SET to — the same four the save path accepts, aliased
// rather than restated so the two lists cannot drift. "expired" is in neither:
// it is derived from valid_until, and transition_quote_status refuses it
// outright.
const STORABLE_QUOTE_STATUSES = QUOTE_STATUSES;

// PostgREST passes a raised SQLSTATE through as error.code — the same way
// save_quote's failures are read above.
const rpcErrorCode = (error: any): string => text(error?.code);

// The database's message names the offending value ("unknown status invoiced",
// "this quote has 2 invoice(s)", "only an accepted quote can be invoiced (this
// one is draft)"). That is more use on screen than anything restated here, so
// it is passed through; the fallback only covers a raise with no message.
const rpcErrorMessage = (error: any, fallback: string): string =>
  text(error?.message).trim() || fallback;

// A body that is not JSON at all becomes {}, so validation answers with the
// field that is missing instead of an opaque 500 from the parse.
const readJsonBody = async (c: any): Promise<any> => {
  const raw = await c.req.json().catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
};

// quote_invoice_links, in the camelCase the client speaks.
const rowToQuoteInvoiceLink = (raw: any) => {
  const row = raw && typeof raw === "object" ? raw : {};
  return {
    id: row.id,
    quoteId: row.quote_id,
    userId: row.user_id,
    invoiceKey: row.invoice_key ?? "",
    invoiceNumber: row.invoice_number ?? "",
    servicePeriodStart: row.service_period_start ?? "",
    servicePeriodEnd: row.service_period_end ?? "",
    invoiceKind: row.invoice_kind ?? "recurring",
    includesSetupFee: Boolean(row.includes_setup_fee),
    createdAt: row.created_at,
  };
};

/**
 * Change a quote's lifecycle status.
 *
 * Body: { to: QuoteStatus, expectedStatus?: QuoteStatus }
 *
 * expectedStatus is optimistic concurrency: the caller says what the status was
 * when it drew the screen, and the function refuses the move if it has changed
 * since. Omitting it means "whatever it is now".
 */
app.patch("/make-server-3c030652/quotes/:id/status", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    if (!UUID_RE.test(id)) {
      return c.json({ error: "Quote not found" }, 404);
    }

    const body = await readJsonBody(c);
    const to = text(body.to).trim();

    // "expired" is the one wrong value a caller is likely to send by accident,
    // because it is what the chip on screen says. Answering with the reason is
    // worth more than listing the alternatives.
    if (to === "expired") {
      return c.json(
        {
          error:
            "Expired is derived from the valid-until date, not set directly. Change the date instead.",
        },
        400,
      );
    }
    // Checked here as well as in the function, not only for the message: an
    // absent `to` reaches plpgsql as NULL, `NULL NOT IN (...)` evaluates to
    // NULL, and IF treats that as false — so the function's own guard would let
    // it through and the UPDATE would fail on the NOT NULL column as an
    // unexplained 500.
    if (!STORABLE_QUOTE_STATUSES.includes(to)) {
      return c.json(
        {
          error: `Status "${to}" cannot be set. Use one of: ${STORABLE_QUOTE_STATUSES.join(", ")}.`,
        },
        400,
      );
    }

    const rawExpected = body.expectedStatus;
    const expected =
      rawExpected === undefined || rawExpected === null || rawExpected === ""
        ? null
        : text(rawExpected).trim();
    // Sending the displayed status here ("expired") would never match a stored
    // one, and the caller would get a "changed elsewhere" conflict describing a
    // race that never happened. Name the real problem instead.
    if (expected !== null && !STORABLE_QUOTE_STATUSES.includes(expected)) {
      return c.json(
        {
          error: `Expected status "${expected}" is not a stored status. Send the quote's stored status, not its displayed one.`,
        },
        400,
      );
    }

    const { data, error } = await supabase.rpc("transition_quote_status", {
      p_user_id: userId,
      p_quote_id: id,
      p_to: to,
      p_expected: expected,
      p_email: c.get("userEmail") ?? null,
    });

    if (error || !data) {
      const code = rpcErrorCode(error);
      if (code === "22023") {
        return c.json(
          { error: rpcErrorMessage(error, `Status "${to}" cannot be set.`) },
          400,
        );
      }
      if (code === "P0002") {
        return c.json({ error: "Quote not found" }, 404);
      }
      if (code === "40001") {
        return c.json(
          { error: "This quote was changed elsewhere. Reload and try again." },
          409,
        );
      }
      if (code === "23514") {
        return c.json(
          {
            error: rpcErrorMessage(
              error,
              "This quote has already been invoiced; create a revision instead of changing its status.",
            ),
          },
          409,
        );
      }
      console.error(
        "Error changing quote status:",
        error?.message ?? error ?? "transition_quote_status returned no row",
      );
      return c.json({ error: "Failed to change quote status" }, 500);
    }

    // The function returns the quote row alone — it never touches line items,
    // so it does not carry them, and rowToQuote would report lineItems: [] to a
    // caller that is displaying the document. Read it back the way every other
    // read path does, keeping the function's own effective_status so expiry
    // stays the database's computation rather than this file's twin of it.
    const { data: full, error: readError } = await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (readError || !full) {
      // The status did change; only the re-read failed. Reporting a completed
      // write as an error would have the client show the old chip and retry.
      if (readError) {
        console.error("Error re-reading quote after status change:", readError);
      }
      return c.json({ quote: rowToQuote(data) });
    }

    return c.json({
      quote: rowToQuote({ ...full, effective_status: (data as any).effective_status }),
    });
  } catch (error) {
    console.error("Error changing quote status:", error);
    return c.json({ error: "Failed to change quote status" }, 500);
  }
});

/**
 * Invoice one service period of an accepted quote.
 *
 * Body: { servicePeriodStart: "YYYY-MM-DD", issueDate?, dueDate?, taxPercent?,
 *         notes? }
 *
 * The first invoice for a quote carries the one-time setup fee as its own line;
 * later ones are the monthly charge only. Asking twice for the same period is
 * answered with the invoice that already exists — that is the retry-safe path,
 * not a failure, so it is a 200 and the caller can treat it as success.
 */
app.post("/make-server-3c030652/quotes/:id/invoices", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    if (!UUID_RE.test(id)) {
      return c.json({ error: "Quote not found" }, 404);
    }

    const body = await readJsonBody(c);

    // The period is the identity of the invoice: it is what the UNIQUE
    // (quote_id, service_period_start) constraint makes un-double-billable, so
    // it is required rather than defaulted to today's month.
    const periodStart = text(body.servicePeriodStart).trim();
    if (!isISODate(periodStart)) {
      return c.json(
        {
          error: `Service period start "${periodStart}" is not a valid date. Use YYYY-MM-DD.`,
        },
        400,
      );
    }

    // Both optional: the function derives the issue date from the period start
    // and the due date from the issue date. An unparseable one is rejected
    // rather than dropped, so a typo cannot silently date an invoice.
    const issueDate = text(body.issueDate).trim();
    if (issueDate && !isISODate(issueDate)) {
      return c.json(
        { error: `Issue date "${issueDate}" is not a valid date. Use YYYY-MM-DD.` },
        400,
      );
    }
    const dueDate = text(body.dueDate).trim();
    if (dueDate && !isISODate(dueDate)) {
      return c.json(
        { error: `Due date "${dueDate}" is not a valid date. Use YYYY-MM-DD.` },
        400,
      );
    }

    const taxPercent = num(body.taxPercent);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      return c.json(
        {
          error: `Tax percent "${text(body.taxPercent)}" must be a number between 0 and 100.`,
        },
        400,
      );
    }

    const notes =
      body.notes === undefined || body.notes === null ? null : text(body.notes);

    const { data, error } = await supabase.rpc("create_invoice_from_quote", {
      p_user_id: userId,
      p_quote_id: id,
      p_period_start: periodStart,
      p_issue_date: issueDate || null,
      p_due_date: dueDate || null,
      p_tax_percent: taxPercent,
      p_notes: notes,
      p_email: c.get("userEmail") ?? null,
    });

    if (error || !data) {
      const code = rpcErrorCode(error);
      if (code === "P0002") {
        return c.json({ error: "Quote not found" }, 404);
      }
      if (code === "23514") {
        return c.json(
          {
            error: rpcErrorMessage(
              error,
              "Only an accepted quote can be invoiced.",
            ),
          },
          409,
        );
      }
      console.error(
        "Error creating invoice from quote:",
        error?.message ?? error ?? "create_invoice_from_quote returned no row",
      );
      return c.json({ error: "Failed to create invoice from quote" }, 500);
    }

    if ((data as any).alreadyExists) {
      return c.json({
        alreadyExists: true,
        link: rowToQuoteInvoiceLink((data as any).link),
      });
    }

    // The invoice blob is built and stored by the function, already in the
    // camelCase shape the invoice routes above return; passing it through
    // unchanged is what keeps it equal to the stored record to the cent.
    return c.json({ invoice: (data as any).invoice }, 201);
  } catch (error) {
    console.error("Error creating invoice from quote:", error);
    return c.json({ error: "Failed to create invoice from quote" }, 500);
  }
});

/**
 * Every invoice raised from this quote, oldest service period first.
 *
 * This client holds the service-role key, so RLS is not what scopes the read:
 * the user_id filter is, exactly as it is on every other quote query here. A
 * quote belonging to someone else simply has no rows the caller can see.
 */
app.get("/make-server-3c030652/quotes/:id/invoices", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    if (!UUID_RE.test(id)) {
      return c.json({ error: "Quote not found" }, 404);
    }

    const { data, error } = await supabase
      .from("quote_invoice_links")
      .select("*")
      .eq("quote_id", id)
      .eq("user_id", userId)
      .order("service_period_start", { ascending: true });

    if (error) {
      console.error("Error fetching invoices for quote:", error);
      return c.json({ error: "Failed to fetch invoices for this quote" }, 500);
    }

    return c.json({ links: (data || []).map(rowToQuoteInvoiceLink) });
  } catch (error) {
    console.error("Error fetching invoices for quote:", error);
    return c.json({ error: "Failed to fetch invoices for this quote" }, 500);
  }
});

app.get("/make-server-3c030652/quotes", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");

    const { data, error } = await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching quotes:", error);
      return c.json({ error: "Failed to fetch quotes" }, 500);
    }

    return c.json({ quotes: (data || []).map(rowToQuote) });
  } catch (error) {
    console.error("Error fetching quotes:", error);
    return c.json({ error: "Failed to fetch quotes" }, 500);
  }
});

// Get a single quote with its line items
app.get("/make-server-3c030652/quotes/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    // A non-uuid id cannot match any row; answering 404 keeps Postgres from
    // raising a cast error we would have to report as a 500.
    if (!UUID_RE.test(id)) {
      return c.json({ error: "Quote not found" }, 404);
    }

    const { data, error } = await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching quote:", error);
      return c.json({ error: "Failed to fetch quote" }, 500);
    }

    if (!data) {
      return c.json({ error: "Quote not found" }, 404);
    }

    return c.json({ quote: rowToQuote(data) });
  } catch (error) {
    console.error("Error fetching quote:", error);
    return c.json({ error: "Failed to fetch quote" }, 500);
  }
});

// Create a quote
app.post("/make-server-3c030652/quotes", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const body = readQuoteBody(await c.req.json());

    const invalid = validateQuoteBody(body);
    if (invalid) {
      return c.json({ error: invalid }, 400);
    }

    // One transaction: the row and its line items either both exist or
    // neither does, so there is no half-created quote to roll back by hand.
    const { data, error } = await saveQuote(
      userId,
      c.get("userEmail"),
      body,
      null,
    );

    if (error || !data) {
      const failure = saveQuoteFailure(
        error,
        text(body.quoteNumber).trim(),
        "Failed to create quote",
      );
      return c.json(failure.body, failure.status);
    }

    return c.json({ quote: rowToQuote(data) });
  } catch (error) {
    console.error("Error creating quote:", error);
    return c.json({ error: "Failed to create quote" }, 500);
  }
});

// Update a quote
app.put("/make-server-3c030652/quotes/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const body = readQuoteBody(await c.req.json());

    if (!UUID_RE.test(id)) {
      return c.json({ error: "Quote not found" }, 404);
    }

    const invalid = validateQuoteBody(body);
    if (invalid) {
      return c.json({ error: invalid }, 400);
    }

    // Line items are replaced wholesale — positions shift, rows are added and
    // removed, and diffing them buys nothing — but the replacement happens
    // inside save_quote's transaction. If the insert raises, the delete rolls
    // back with it and the previous items are still there. The ownership check
    // is the function's own: an id belonging to another account raises P0002,
    // which maps to the same 404 the read paths return.
    const { data, error } = await saveQuote(
      userId,
      c.get("userEmail"),
      body,
      id,
    );

    if (error || !data) {
      const failure = saveQuoteFailure(
        error,
        text(body.quoteNumber).trim(),
        "Failed to update quote",
      );
      return c.json(failure.body, failure.status);
    }

    return c.json({ quote: rowToQuote(data) });
  } catch (error) {
    console.error("Error updating quote:", error);
    return c.json({ error: "Failed to update quote" }, 500);
  }
});

// Delete a quote (line items cascade)
app.delete("/make-server-3c030652/quotes/:id", requireAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    if (!UUID_RE.test(id)) {
      return c.json({ error: "Quote not found" }, 404);
    }

    const { data, error } = await supabase
      .from("quotes")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");

    if (error) {
      // quote_invoice_links.quote_id is ON DELETE RESTRICT (20260816 migration),
      // so deleting an invoiced quote raises foreign_key_violation. That is a
      // rule, not a fault — the invoices would be left describing a document
      // that no longer exists — and without this branch the person clicking
      // Delete is told only "Failed to delete quote" with a 500.
      if (rpcErrorCode(error) === "23503") {
        return c.json(
          {
            error:
              "This quote has invoices raised against it and can no longer be deleted.",
          },
          409,
        );
      }
      console.error("Error deleting quote:", error);
      return c.json({ error: "Failed to delete quote" }, 500);
    }

    if (!data || data.length === 0) {
      return c.json({ error: "Quote not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting quote:", error);
    return c.json({ error: "Failed to delete quote" }, 500);
  }
});

Deno.serve(app.fetch);