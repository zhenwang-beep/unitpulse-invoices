-- Service quotes.
--
-- Invoices, clients and items live in kv_store_3c030652 as opaque JSON blobs.
-- Quotes do not: the money, dates and status here are business data that need
-- types, constraints and indexes, so they get real columns. Only the narrative
-- document sections (scope groups, inclusions, exclusions) stay JSONB, because
-- they are prose that is rendered, never queried or aggregated.
--
-- Money is numeric(12,2) throughout — never float, which cannot represent
-- currency exactly.

CREATE TABLE IF NOT EXISTS public.quotes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_email     text,

  quote_number         text NOT NULL,
  status               text NOT NULL DEFAULT 'draft',

  -- Issued to (the client)
  client_name          text NOT NULL DEFAULT '',
  client_contact_name  text,
  client_contact_title text,
  client_email         text,
  client_phone         text,
  client_address       text,

  -- Issued by (the account executive)
  issuer_name          text,
  issuer_email         text,
  issuer_phone         text,

  -- Dark header band
  service_line         text,
  prepared_for_address text,

  -- Dates
  quote_date           date NOT NULL DEFAULT CURRENT_DATE,
  valid_until          date NOT NULL DEFAULT (CURRENT_DATE + 30),
  service_start_date   date,

  -- Section 03 — commercial terms
  initial_term_months  integer,
  renewal_terms        text,
  cancellation_terms   text,
  billing_cadence      text,
  payment_terms        text,
  price_change_terms   text,
  quote_validity_terms text,

  -- Section 01 — money
  currency             text NOT NULL DEFAULT 'USD',
  subtotal             numeric(12,2) NOT NULL DEFAULT 0,
  setup_fee            numeric(12,2) NOT NULL DEFAULT 0,
  total_monthly        numeric(12,2) NOT NULL DEFAULT 0,

  -- Sections 02 & 04 — document prose
  scope_groups         jsonb NOT NULL DEFAULT '[]'::jsonb,
  included             jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded             jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions_note     text,
  notes                text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quotes_status_check
    CHECK (status IN ('draft','sent','accepted','declined','expired')),
  CONSTRAINT quotes_amounts_nonneg
    CHECK (subtotal >= 0 AND setup_fee >= 0 AND total_monthly >= 0),
  CONSTRAINT quotes_valid_until_after_quote_date
    CHECK (valid_until >= quote_date),
  CONSTRAINT quotes_term_positive
    CHECK (initial_term_months IS NULL OR initial_term_months > 0),
  CONSTRAINT quotes_prose_is_array
    CHECK (jsonb_typeof(scope_groups) = 'array'
       AND jsonb_typeof(included)     = 'array'
       AND jsonb_typeof(excluded)     = 'array'),
  -- Quote numbers are client-facing identifiers; two quotes from one user must
  -- never share one. Scoped per user so separate accounts can't collide.
  CONSTRAINT quotes_number_unique_per_user UNIQUE (user_id, quote_number)
);

CREATE TABLE IF NOT EXISTS public.quote_line_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  service_name text NOT NULL DEFAULT '',
  description  text,
  quantity     numeric(12,2) NOT NULL DEFAULT 1,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0,
  -- Derived in the database so a line total can never drift from its inputs.
  amount       numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Bounded so the generated product always fits numeric(14,2):
  -- 100,000 x 1,000,000 = 1e11 < 1e12.
  CONSTRAINT quote_line_items_qty_range   CHECK (quantity   >= 0 AND quantity   <= 100000),
  CONSTRAINT quote_line_items_price_range CHECK (unit_price >= 0 AND unit_price <= 1000000)
);

CREATE INDEX IF NOT EXISTS quotes_user_created_idx
  ON public.quotes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotes_user_status_idx
  ON public.quotes (user_id, status);
-- Expiry is derived from valid_until rather than stored, so it has to be
-- cheap to filter on.
CREATE INDEX IF NOT EXISTS quotes_user_valid_until_idx
  ON public.quotes (user_id, valid_until);
-- UNIQUE, not just an index: two rows at position 0 would order arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS quote_line_items_quote_position_idx
  ON public.quote_line_items (quote_id, position);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_set_updated_at ON public.quotes;
CREATE TRIGGER quotes_set_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS.
--
-- One write path, deliberately: the edge function holds the service role,
-- recomputes totals from the line items, and enforces status and date rules.
-- An earlier draft granted clients FOR ALL, which would have let the browser
-- write subtotal, total_monthly or status directly and skip every one of those
-- checks — a client could have set its own total. So writes are revoked from
-- anon/authenticated entirely and only owner-scoped SELECT is policied. The
-- service role bypasses RLS by design and is unaffected.
ALTER TABLE public.quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quotes           FROM anon, authenticated;
REVOKE ALL ON public.quote_line_items FROM anon, authenticated;
GRANT SELECT ON public.quotes           TO authenticated;
GRANT SELECT ON public.quote_line_items TO authenticated;

DROP POLICY IF EXISTS quotes_owner_all    ON public.quotes;
DROP POLICY IF EXISTS quotes_owner_select ON public.quotes;
CREATE POLICY quotes_owner_select ON public.quotes
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS quote_line_items_owner_all    ON public.quote_line_items;
DROP POLICY IF EXISTS quote_line_items_owner_select ON public.quote_line_items;
CREATE POLICY quote_line_items_owner_select ON public.quote_line_items
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = quote_line_items.quote_id AND q.user_id = auth.uid()));
