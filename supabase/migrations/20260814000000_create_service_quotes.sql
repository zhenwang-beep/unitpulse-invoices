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

-- ===========================================================================
-- Derived money
--
-- total_monthly is the RECURRING charge. A one-time setup fee is deliberately
-- not part of it: folding it in prints "$899 due monthly" for a $399 service
-- with a $500 setup fee, on a document the client signs. What they actually
-- pay up front is the first month plus the fee, so that gets its own derived
-- column rather than being recomputed (differently) by each renderer.
-- numeric(14,2) because the sum of two numeric(12,2) values can carry an
-- eleventh integer digit.
-- ===========================================================================
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS initial_amount_due numeric(14,2)
  GENERATED ALWAYS AS (total_monthly + setup_fee) STORED;

-- ===========================================================================
-- Effective status
--
-- Expiry is a function of valid_until, not a separate stored fact. Storing
-- 'expired' would give two sources of truth that drift the moment a date
-- passes without a job running. One definition, used by the API and the UI.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.quote_effective_status(
  p_status text,
  p_valid_until date
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_status IN ('draft','sent') AND p_valid_until < CURRENT_DATE THEN 'expired'
    ELSE p_status
  END;
$$;

-- ===========================================================================
-- save_quote — the ONLY write path for a quote and its lines.
--
-- Everything here happens in one transaction: a plpgsql function either
-- commits whole or rolls back whole. The previous edge-function approach
-- (update parent, DELETE all lines, INSERT replacements) destroyed the old
-- line items if the insert failed, and there was no way to get them back.
--
-- Totals are summed HERE, from the same rows being stored, so a persisted
-- total can never disagree with its line items — and the arithmetic is
-- Postgres numeric, not JavaScript binary floating point, so 0.01 * 14.50
-- rounds the same way in the database as it does in the generated `amount`
-- column. The client's own subtotal/total fields are ignored entirely.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.save_quote(
  p_user_id  uuid,
  p_email    text,
  p_quote    jsonb,
  p_items    jsonb,
  p_quote_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id        uuid;
  v_subtotal  numeric(12,2);
  v_setup_fee numeric(12,2);
  v_number    text;
  v_supplied  boolean;
  v_year      text := to_char(CURRENT_DATE, 'YYYY');
  v_attempt   int;
  v_result    jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  v_setup_fee := round(COALESCE((p_quote->>'setup_fee')::numeric, 0), 2);

  SELECT COALESCE(SUM(round(
           COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
         * COALESCE(NULLIF(it->>'unit_price','')::numeric, 0), 2)), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it;

  v_number   := NULLIF(btrim(COALESCE(p_quote->>'quote_number', '')), '');
  v_supplied := v_number IS NOT NULL;

  -- On an update, the caller must own the row. Filtering on both id and
  -- user_id means another account's quote simply matches nothing.
  IF p_quote_id IS NOT NULL THEN
    PERFORM 1 FROM public.quotes WHERE id = p_quote_id AND user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Browser-side random numbers collide ~42% of the time within 100 quotes,
  -- so an unspecified number is allocated here and retried on conflict. A
  -- number the user typed is never silently changed — that 23505 surfaces.
  FOR v_attempt IN 1..8 LOOP
    BEGIN
      IF v_number IS NULL THEN
        SELECT 'UP-' || v_year || '-' || lpad((COALESCE(MAX(
                 NULLIF(regexp_replace(quote_number, '^.*-', ''), '')::int), 0)
                 + v_attempt)::text, 4, '0')
          INTO v_number
          FROM public.quotes
         WHERE user_id = p_user_id
           AND quote_number ~ ('^UP-' || v_year || '-[0-9]+$');
      END IF;

      IF p_quote_id IS NULL THEN
        INSERT INTO public.quotes (
          user_id, created_by_email, quote_number, status,
          client_name, client_contact_name, client_contact_title,
          client_email, client_phone, client_address,
          issuer_name, issuer_email, issuer_phone,
          service_line, prepared_for_address,
          quote_date, valid_until, service_start_date,
          initial_term_months, renewal_terms, cancellation_terms,
          billing_cadence, payment_terms, price_change_terms,
          quote_validity_terms,
          currency, subtotal, setup_fee, total_monthly,
          scope_groups, included, excluded, assumptions_note, notes
        ) VALUES (
          p_user_id, p_email, v_number,
          COALESCE(NULLIF(p_quote->>'status',''), 'draft'),
          COALESCE(p_quote->>'client_name',''),
          p_quote->>'client_contact_name', p_quote->>'client_contact_title',
          p_quote->>'client_email', p_quote->>'client_phone',
          p_quote->>'client_address',
          p_quote->>'issuer_name', p_quote->>'issuer_email',
          p_quote->>'issuer_phone',
          p_quote->>'service_line', p_quote->>'prepared_for_address',
          COALESCE(NULLIF(p_quote->>'quote_date','')::date, CURRENT_DATE),
          COALESCE(NULLIF(p_quote->>'valid_until','')::date, CURRENT_DATE + 30),
          NULLIF(p_quote->>'service_start_date','')::date,
          NULLIF(p_quote->>'initial_term_months','')::int,
          p_quote->>'renewal_terms', p_quote->>'cancellation_terms',
          p_quote->>'billing_cadence', p_quote->>'payment_terms',
          p_quote->>'price_change_terms', p_quote->>'quote_validity_terms',
          COALESCE(NULLIF(p_quote->>'currency',''), 'USD'),
          v_subtotal, v_setup_fee, v_subtotal,
          COALESCE(p_quote->'scope_groups', '[]'::jsonb),
          COALESCE(p_quote->'included', '[]'::jsonb),
          COALESCE(p_quote->'excluded', '[]'::jsonb),
          p_quote->>'assumptions_note', p_quote->>'notes'
        ) RETURNING id INTO v_id;
      ELSE
        UPDATE public.quotes SET
          quote_number         = v_number,
          status               = COALESCE(NULLIF(p_quote->>'status',''), status),
          client_name          = COALESCE(p_quote->>'client_name',''),
          client_contact_name  = p_quote->>'client_contact_name',
          client_contact_title = p_quote->>'client_contact_title',
          client_email         = p_quote->>'client_email',
          client_phone         = p_quote->>'client_phone',
          client_address       = p_quote->>'client_address',
          issuer_name          = p_quote->>'issuer_name',
          issuer_email         = p_quote->>'issuer_email',
          issuer_phone         = p_quote->>'issuer_phone',
          service_line         = p_quote->>'service_line',
          prepared_for_address = p_quote->>'prepared_for_address',
          quote_date           = COALESCE(NULLIF(p_quote->>'quote_date','')::date, quote_date),
          valid_until          = COALESCE(NULLIF(p_quote->>'valid_until','')::date, valid_until),
          service_start_date   = NULLIF(p_quote->>'service_start_date','')::date,
          initial_term_months  = NULLIF(p_quote->>'initial_term_months','')::int,
          renewal_terms        = p_quote->>'renewal_terms',
          cancellation_terms   = p_quote->>'cancellation_terms',
          billing_cadence      = p_quote->>'billing_cadence',
          payment_terms        = p_quote->>'payment_terms',
          price_change_terms   = p_quote->>'price_change_terms',
          quote_validity_terms = p_quote->>'quote_validity_terms',
          currency             = COALESCE(NULLIF(p_quote->>'currency',''), currency),
          subtotal             = v_subtotal,
          setup_fee            = v_setup_fee,
          total_monthly        = v_subtotal,
          scope_groups         = COALESCE(p_quote->'scope_groups', '[]'::jsonb),
          included             = COALESCE(p_quote->'included', '[]'::jsonb),
          excluded             = COALESCE(p_quote->'excluded', '[]'::jsonb),
          assumptions_note     = p_quote->>'assumptions_note',
          notes                = p_quote->>'notes'
        WHERE id = p_quote_id AND user_id = p_user_id
        RETURNING id INTO v_id;
      END IF;

      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_supplied OR v_attempt = 8 THEN
        RAISE;
      END IF;
      v_number := NULL;  -- allocate a fresh one and try again
    END;
  END LOOP;

  -- Replacing the lines inside this transaction is what makes the delete safe:
  -- if the insert raises, the delete rolls back with it.
  DELETE FROM public.quote_line_items WHERE quote_id = v_id;

  INSERT INTO public.quote_line_items
    (quote_id, position, service_name, description, quantity, unit_price)
  SELECT
    v_id,
    (ord - 1)::int,
    COALESCE(it->>'service_name', ''),
    it->>'description',
    round(COALESCE(NULLIF(it->>'quantity','')::numeric, 0), 2),
    round(COALESCE(NULLIF(it->>'unit_price','')::numeric, 0), 2)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t(it, ord);

  SELECT to_jsonb(q) || jsonb_build_object(
           'effective_status', public.quote_effective_status(q.status, q.valid_until),
           'line_items', COALESCE((
             SELECT jsonb_agg(to_jsonb(li) ORDER BY li.position)
               FROM public.quote_line_items li WHERE li.quote_id = q.id
           ), '[]'::jsonb))
    INTO v_result
    FROM public.quotes q WHERE q.id = v_id;

  RETURN v_result;
END;
$$;

-- Only the service role may call it; the edge function is the write path.
REVOKE ALL ON FUNCTION public.save_quote(uuid, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
