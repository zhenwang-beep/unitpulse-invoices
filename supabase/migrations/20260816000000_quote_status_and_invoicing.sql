-- Quote lifecycle + billing.
--
-- Two changes, both forward-only (the earlier migrations are already applied):
--
-- 1. `expired` stops being a storable status. quote_effective_status() derives
--    it from valid_until, but the CHECK constraint also permitted storing it
--    and the editor offered it in a dropdown — so a user could persist a value
--    the system computes, after which extending valid_until would not clear it.
--    One source of truth: the date.
--
-- 2. A recurring quote is a standing agreement that bills MANY times, so the
--    quote→invoice relationship is one-to-many from the start. Modelling it
--    one-to-one breaks in month two: nowhere to put the second invoice, and no
--    way to stop the same period being billed twice.

-- ---------------------------------------------------------------------------
-- 1. Lifecycle status
-- ---------------------------------------------------------------------------
UPDATE public.quotes SET status = 'sent' WHERE status = 'expired';

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft','sent','accepted','declined'));

-- Who moved a quote and when. A quote is a commercial document; "it says
-- declined and nobody knows why" is not an acceptable answer.
CREATE TABLE IF NOT EXISTS public.quote_status_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_email text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_status_events_quote_idx
  ON public.quote_status_events (quote_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Quote → invoice links
--
-- Invoices stay in kv_store_3c030652. Normalising them would touch creation,
-- editing, listing, PDF export and every existing record, none of which this
-- feature needs. But the LINK is relational, so it can carry constraints:
-- one link per invoice, and one invoice per quote per service period — which
-- is what makes double-billing a month impossible rather than merely unlikely.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quote_invoice_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id             uuid NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  invoice_key          text NOT NULL,
  invoice_number       text NOT NULL,
  service_period_start date NOT NULL,
  service_period_end   date NOT NULL,
  invoice_kind         text NOT NULL DEFAULT 'recurring',
  includes_setup_fee   boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quote_invoice_links_kind_check
    CHECK (invoice_kind IN ('initial','recurring')),
  CONSTRAINT quote_invoice_links_period_order
    CHECK (service_period_end >= service_period_start),
  -- ON DELETE RESTRICT above plus this: an invoiced quote cannot be deleted
  -- out from under its invoices.
  CONSTRAINT quote_invoice_links_unique_invoice UNIQUE (user_id, invoice_key),
  CONSTRAINT quote_invoice_links_unique_period
    UNIQUE (quote_id, service_period_start)
);
CREATE INDEX IF NOT EXISTS quote_invoice_links_quote_idx
  ON public.quote_invoice_links (quote_id, service_period_start);

ALTER TABLE public.quote_status_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_invoice_links  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_status_events FROM anon, authenticated;
REVOKE ALL ON public.quote_invoice_links FROM anon, authenticated;
GRANT SELECT ON public.quote_status_events TO authenticated;
GRANT SELECT ON public.quote_invoice_links TO authenticated;

DROP POLICY IF EXISTS quote_status_events_owner_select ON public.quote_status_events;
CREATE POLICY quote_status_events_owner_select ON public.quote_status_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS quote_invoice_links_owner_select ON public.quote_invoice_links;
CREATE POLICY quote_invoice_links_owner_select ON public.quote_invoice_links
  FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- transition_quote_status — the only way lifecycle status changes.
--
-- Deliberately NOT the existing PUT /quotes/:id route: that calls save_quote(),
-- which replaces every line item wholesale. Clicking a status chip must not
-- rewrite the commercial content of a document.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_quote_status(
  p_user_id  uuid,
  p_quote_id uuid,
  p_to       text,
  p_expected text DEFAULT NULL,
  p_email    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from      text;
  v_valid     date;
  v_invoices  int;
BEGIN
  IF p_to = 'expired' THEN
    RAISE EXCEPTION 'expired is derived from the valid-until date, not set directly'
      USING ERRCODE = '22023';
  END IF;
  IF p_to NOT IN ('draft','sent','accepted','declined') THEN
    RAISE EXCEPTION 'unknown status %', p_to USING ERRCODE = '22023';
  END IF;

  SELECT status, valid_until INTO v_from, v_valid
    FROM public.quotes
   WHERE id = p_quote_id AND user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
  END IF;

  -- Optimistic concurrency: the caller says what it believed the status was.
  IF p_expected IS NOT NULL AND p_expected <> v_from THEN
    RAISE EXCEPTION 'quote status changed to % since it was loaded', v_from
      USING ERRCODE = '40001';
  END IF;

  -- An invoiced quote is a billed agreement. Reopening it would leave invoices
  -- pointing at a document that no longer says what was billed.
  SELECT count(*) INTO v_invoices
    FROM public.quote_invoice_links WHERE quote_id = p_quote_id;
  IF v_invoices > 0 AND p_to <> v_from THEN
    RAISE EXCEPTION 'this quote has % invoice(s); create a revision instead of changing its status', v_invoices
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.quotes SET status = p_to
   WHERE id = p_quote_id AND user_id = p_user_id;

  INSERT INTO public.quote_status_events
    (quote_id, user_id, from_status, to_status, actor_email)
  VALUES (p_quote_id, p_user_id, v_from, p_to, p_email);

  RETURN (
    SELECT to_jsonb(q) || jsonb_build_object(
      'effective_status', public.quote_effective_status(q.status, q.valid_until))
      FROM public.quotes q WHERE q.id = p_quote_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- create_invoice_from_quote — writes the invoice blob AND its link in one
-- transaction, so a link can never point at a missing invoice and an invoice
-- can never be silently orphaned.
--
-- Uses INSERT, not the generic kv.set() helper, which upserts: an invoice-number
-- collision there would overwrite somebody's existing invoice. On collision this
-- retries with a fresh number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invoice_from_quote(
  p_user_id      uuid,
  p_quote_id     uuid,
  p_period_start date,
  p_issue_date   date DEFAULT NULL,
  p_due_date     date DEFAULT NULL,
  p_tax_percent  numeric DEFAULT 0,
  p_notes        text    DEFAULT NULL,
  p_email        text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q             public.quotes%ROWTYPE;
  v_kind        text;
  v_setup       boolean;
  v_period_end  date;
  v_issue       date;
  v_due         date;
  v_number      text;
  v_key         text;
  v_lines       jsonb;
  v_subtotal    numeric(18,2);
  v_tax         numeric(18,2);
  v_total       numeric(18,2);
  v_blob        jsonb;
  v_attempt     int;
  v_existing    jsonb;
BEGIN
  SELECT * INTO q FROM public.quotes
   WHERE id = p_quote_id AND user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
  END IF;

  IF q.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted quote can be invoiced (this one is %)', q.status
      USING ERRCODE = '23514';
  END IF;

  -- Retry-safe: asking twice for the same service period returns the invoice
  -- that already exists rather than billing the client a second time.
  SELECT to_jsonb(l) INTO v_existing
    FROM public.quote_invoice_links l
   WHERE l.quote_id = p_quote_id AND l.service_period_start = p_period_start;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('alreadyExists', true, 'link', v_existing);
  END IF;

  -- The first invoice for a quote carries the one-time setup fee; later ones
  -- are the recurring charge only.
  SELECT count(*) = 0 INTO v_setup
    FROM public.quote_invoice_links WHERE quote_id = p_quote_id;
  v_kind  := CASE WHEN v_setup THEN 'initial' ELSE 'recurring' END;
  v_setup := v_setup AND COALESCE(q.setup_fee, 0) > 0;

  v_period_end := (p_period_start + interval '1 month' - interval '1 day')::date;
  v_issue := COALESCE(p_issue_date, p_period_start);
  v_due   := COALESCE(p_due_date, (v_issue + interval '30 days')::date);

  -- Recurring lines for one month, at the prices the quote fixed. The setup
  -- fee becomes its own line so the invoice explains itself.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', li.id::text,
             'description',
               li.service_name || CASE WHEN COALESCE(li.description,'') <> ''
                                       THEN ' — ' || li.description ELSE '' END,
             'quantity', li.quantity,
             'unitPrice', li.unit_price)
           ORDER BY li.position), '[]'::jsonb)
    INTO v_lines
    FROM public.quote_line_items li WHERE li.quote_id = p_quote_id;

  IF v_setup THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'description', 'One-time setup fee',
      'quantity', 1,
      'unitPrice', q.setup_fee));
  END IF;

  SELECT COALESCE(SUM(round((e->>'quantity')::numeric * (e->>'unitPrice')::numeric, 2)), 0)
    INTO v_subtotal FROM jsonb_array_elements(v_lines) e;
  v_tax   := round(v_subtotal * COALESCE(p_tax_percent, 0) / 100.0, 2);
  v_total := v_subtotal + v_tax;

  FOR v_attempt IN 1..8 LOOP
    BEGIN
      v_number := 'INV-' || lpad((floor(random() * 900000) + 100000)::bigint::text, 6, '0');
      v_key    := 'user_' || p_user_id::text || '_invoice_' || v_number;

      v_blob := jsonb_build_object(
        'id', v_key,
        'userId', p_user_id,
        'createdByEmail', p_email,
        'invoiceId', v_number,
        'issueDate', to_char(v_issue, 'YYYY-MM-DD'),
        'dueDate',   to_char(v_due,   'YYYY-MM-DD'),
        'clientName', q.client_name,
        'clientAddress', COALESCE(q.client_address, ''),
        'clientCity', '', 'clientState', '', 'clientZip', '',
        'clientCountry', 'United States',
        'lineItems', v_lines,
        'taxPercent', COALESCE(p_tax_percent, 0),
        'notes', COALESCE(p_notes, ''),
        'subtotal', v_subtotal, 'tax', v_tax, 'total', v_total,
        'createdAt', now(),
        -- forward reference, so an invoice can name its agreement without a join
        'sourceQuoteId', q.id,
        'sourceQuoteNumber', q.quote_number,
        'servicePeriodStart', to_char(p_period_start, 'YYYY-MM-DD'),
        'servicePeriodEnd',   to_char(v_period_end,  'YYYY-MM-DD'),
        'invoiceKind', v_kind);

      -- INSERT, never upsert: colliding on a number must not overwrite an
      -- invoice that already exists.
      INSERT INTO public.kv_store_3c030652 (key, value) VALUES (v_key, v_blob);

      INSERT INTO public.quote_invoice_links
        (user_id, quote_id, invoice_key, invoice_number, service_period_start,
         service_period_end, invoice_kind, includes_setup_fee)
      VALUES (p_user_id, p_quote_id, v_key, v_number, p_period_start,
              v_period_end, v_kind, v_setup);

      RETURN jsonb_build_object('alreadyExists', false, 'invoice', v_blob);
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt = 8 THEN RAISE; END IF;
      -- another invoice already owns that number; try a new one
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_quote_status(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_quote_status(uuid, uuid, text, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.create_invoice_from_quote(uuid, uuid, date, date, date, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_quote(uuid, uuid, date, date, date, numeric, text, text)
  TO service_role;
