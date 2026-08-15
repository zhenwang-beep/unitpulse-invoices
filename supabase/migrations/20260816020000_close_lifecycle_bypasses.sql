-- Close the bypasses around the lifecycle controls.
--
-- The previous migration put a gate on the front door and left the side door
-- open: transition_quote_status() enforced the graph, terminal states, the
-- invoice freeze and the audit trail, while save_quote() — which the ordinary
-- editor PUT calls — wrote `status` directly and happily rewrote the commercial
-- content of an accepted, already-invoiced quote. You could reopen a $399 quote
-- that had been billed, change it to $699, save, and raise month two at the new
-- price with nothing recording that it happened.
--
-- Four changes:
--   1. save_quote no longer touches status at all. Lifecycle moves only through
--      transition_quote_status.
--   2. save_quote refuses to edit a quote that is decided (accepted/declined) or
--      that has invoices. Those need a revision, not an edit.
--   3. An effectively-expired quote cannot be accepted. The old code read
--      valid_until into v_valid and never used it, so a quote the UI showed as
--      expired could be accepted and invoiced immediately.
--   4. Service periods are canonical calendar months, created in order, and the
--      setup fee attaches to the EARLIEST period rather than whichever row was
--      inserted first.

-- ---------------------------------------------------------------------------
-- 1 & 2 — save_quote stops being a lifecycle write path
-- ---------------------------------------------------------------------------
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
  v_subtotal  numeric(18,2);
  v_setup_fee numeric(18,2);
  v_number    text;
  v_supplied  boolean;
  v_allocate  boolean;
  v_attempt   int;
  v_status    text;
  v_invoices  int;
  v_result    jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  v_setup_fee := round(COALESCE((p_quote->>'setup_fee')::numeric, 0), 2);
  v_number    := NULLIF(btrim(COALESCE(p_quote->>'quote_number', '')), '');
  v_supplied  := v_number IS NOT NULL;
  v_allocate  := (p_quote_id IS NULL) AND NOT v_supplied;

  IF p_quote_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.quotes
     WHERE id = p_quote_id AND user_id = p_user_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
    END IF;

    -- A decided quote is a commercial position, not a draft.
    IF v_status IN ('accepted','declined') THEN
      RAISE EXCEPTION
        'this quote is % and can no longer be edited; create a revision instead', v_status
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_invoices
      FROM public.quote_invoice_links WHERE quote_id = p_quote_id;
    IF v_invoices > 0 THEN
      RAISE EXCEPTION
        'this quote has % invoice(s) and can no longer be edited; create a revision instead', v_invoices
        USING ERRCODE = '23514';
    END IF;
  END IF;

  FOR v_attempt IN 1..8 LOOP
    BEGIN
      IF v_allocate THEN
        v_number := public.next_quote_number(p_user_id, v_attempt);
      END IF;

      IF p_quote_id IS NULL THEN
        -- New quotes always start as drafts. A client cannot open an already
        -- accepted quote by posting one.
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
          p_user_id, p_email, v_number, 'draft',
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
          0, v_setup_fee, 0,
          COALESCE(p_quote->'scope_groups', '[]'::jsonb),
          COALESCE(p_quote->'included', '[]'::jsonb),
          COALESCE(p_quote->'excluded', '[]'::jsonb),
          p_quote->>'assumptions_note', p_quote->>'notes'
        ) RETURNING id INTO v_id;
      ELSE
        -- NOTE: `status` is deliberately absent from this SET list.
        UPDATE public.quotes SET
          quote_number         = CASE WHEN v_supplied THEN v_number ELSE quote_number END,
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
          setup_fee            = v_setup_fee,
          scope_groups         = COALESCE(p_quote->'scope_groups', '[]'::jsonb),
          included             = COALESCE(p_quote->'included', '[]'::jsonb),
          excluded             = COALESCE(p_quote->'excluded', '[]'::jsonb),
          assumptions_note     = p_quote->>'assumptions_note',
          notes                = p_quote->>'notes'
        WHERE id = p_quote_id AND user_id = p_user_id
        RETURNING id INTO v_id;

        IF NOT FOUND OR v_id IS NULL THEN
          RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
        END IF;
      END IF;

      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF NOT v_allocate OR v_attempt = 8 THEN RAISE; END IF;
    END;
  END LOOP;

  DELETE FROM public.quote_line_items WHERE quote_id = v_id;

  INSERT INTO public.quote_line_items
    (quote_id, position, service_name, description, quantity, unit_price)
  SELECT v_id, (ord - 1)::int,
         COALESCE(it->>'service_name',''), it->>'description',
         round(COALESCE(NULLIF(it->>'quantity','')::numeric, 0), 2),
         round(COALESCE(NULLIF(it->>'unit_price','')::numeric, 0), 2)
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
         WITH ORDINALITY AS t(it, ord);

  SELECT COALESCE(SUM(amount), 0) INTO v_subtotal
    FROM public.quote_line_items WHERE quote_id = v_id;
  UPDATE public.quotes SET subtotal = v_subtotal, total_monthly = v_subtotal
   WHERE id = v_id;

  SELECT to_jsonb(q) || jsonb_build_object(
           'effective_status', public.quote_effective_status(q.status, q.valid_until),
           'line_items', COALESCE((SELECT jsonb_agg(to_jsonb(li) ORDER BY li.position)
                                     FROM public.quote_line_items li
                                    WHERE li.quote_id = q.id), '[]'::jsonb))
    INTO v_result FROM public.quotes q WHERE q.id = v_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_quote(uuid, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quote(uuid, text, jsonb, jsonb, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3 — an expired quote cannot be accepted
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
  v_from     text;
  v_valid    date;
  v_invoices int;
  v_allowed  text[];
BEGIN
  IF p_to = 'expired' THEN
    RAISE EXCEPTION 'expired is derived from the valid-until date, not set directly'
      USING ERRCODE = '22023';
  END IF;
  IF p_to NOT IN ('draft','sent','accepted','declined') THEN
    RAISE EXCEPTION 'unknown status %', p_to USING ERRCODE = '22023';
  END IF;

  SELECT status, valid_until INTO v_from, v_valid
    FROM public.quotes WHERE id = p_quote_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected IS NOT NULL AND p_expected <> v_from THEN
    RAISE EXCEPTION 'quote status changed to % since it was loaded', v_from
      USING ERRCODE = '40001';
  END IF;

  IF p_to = v_from THEN
    RETURN (SELECT to_jsonb(q) || jsonb_build_object(
              'effective_status', public.quote_effective_status(q.status, q.valid_until))
              FROM public.quotes q WHERE q.id = p_quote_id);
  END IF;

  -- The UI shows this quote as expired; accepting it would silently revive a
  -- lapsed offer and let it be invoiced. Extend valid_until first.
  IF v_valid < CURRENT_DATE AND v_from IN ('draft','sent') THEN
    RAISE EXCEPTION
      'this quote expired on %; extend the valid-until date before changing its status', v_valid
      USING ERRCODE = '23514';
  END IF;

  v_allowed := CASE v_from
    WHEN 'draft' THEN ARRAY['sent','accepted','declined']
    WHEN 'sent'  THEN ARRAY['accepted','declined','draft']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (p_to = ANY (v_allowed)) THEN
    IF v_from IN ('accepted','declined') THEN
      RAISE EXCEPTION 'a % quote cannot be moved to %; create a revision instead', v_from, p_to
        USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'cannot move a quote from % to %', v_from, p_to USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_invoices
    FROM public.quote_invoice_links WHERE quote_id = p_quote_id;
  IF v_invoices > 0 THEN
    RAISE EXCEPTION 'this quote has % invoice(s); create a revision instead of changing its status', v_invoices
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.quotes SET status = p_to WHERE id = p_quote_id AND user_id = p_user_id;
  INSERT INTO public.quote_status_events (quote_id, user_id, from_status, to_status, actor_email)
  VALUES (p_quote_id, p_user_id, v_from, p_to, p_email);

  RETURN (SELECT to_jsonb(q) || jsonb_build_object(
            'effective_status', public.quote_effective_status(q.status, q.valid_until))
            FROM public.quotes q WHERE q.id = p_quote_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_quote_status(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_quote_status(uuid, uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4 — canonical, ordered service periods; setup fee on the EARLIEST one
--
-- UNIQUE(quote_id, service_period_start) stopped identical starts but allowed
-- Aug 1–31 and Aug 2–Sep 1 to both bill a full month. Billing here is monthly
-- in advance, so a period IS a calendar month.
-- ---------------------------------------------------------------------------
ALTER TABLE public.quote_invoice_links
  DROP CONSTRAINT IF EXISTS quote_invoice_links_period_is_month_start;
ALTER TABLE public.quote_invoice_links
  ADD CONSTRAINT quote_invoice_links_period_is_month_start
  CHECK (service_period_start = date_trunc('month', service_period_start)::date);

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
  q            public.quotes%ROWTYPE;
  v_kind       text;
  v_setup      boolean;
  v_period_end date;
  v_issue      date;
  v_due        date;
  v_number     text;
  v_key        text;
  v_lines      jsonb;
  v_subtotal   numeric(18,2);
  v_tax        numeric(18,2);
  v_total      numeric(18,2);
  v_blob       jsonb;
  v_attempt    int;
  v_existing   jsonb;
  v_latest     date;
BEGIN
  IF p_period_start <> date_trunc('month', p_period_start)::date THEN
    RAISE EXCEPTION 'a service period must start on the first of a month (got %)', p_period_start
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO q FROM public.quotes
   WHERE id = p_quote_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
  END IF;
  IF q.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted quote can be invoiced (this one is %)', q.status
      USING ERRCODE = '23514';
  END IF;

  SELECT to_jsonb(l) INTO v_existing FROM public.quote_invoice_links l
   WHERE l.quote_id = p_quote_id AND l.service_period_start = p_period_start;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('alreadyExists', true, 'link', v_existing);
  END IF;

  -- Periods are billed in order. Without this, invoicing September first would
  -- hand the setup fee to September and leave August as a "recurring" invoice.
  SELECT max(service_period_start) INTO v_latest
    FROM public.quote_invoice_links WHERE quote_id = p_quote_id;
  IF v_latest IS NOT NULL AND p_period_start < v_latest THEN
    RAISE EXCEPTION
      'this quote is already invoiced up to %; bill periods in order', v_latest
      USING ERRCODE = '23514';
  END IF;

  -- "Initial" means the earliest service month, not whichever row was written
  -- first, so the one-time fee always lands on the first month billed.
  v_kind  := CASE WHEN v_latest IS NULL THEN 'initial' ELSE 'recurring' END;
  v_setup := (v_latest IS NULL) AND COALESCE(q.setup_fee, 0) > 0;

  v_period_end := (p_period_start + interval '1 month' - interval '1 day')::date;
  v_issue := COALESCE(p_issue_date, p_period_start);
  v_due   := COALESCE(p_due_date, (v_issue + interval '30 days')::date);
  IF v_due < v_issue THEN
    RAISE EXCEPTION 'the due date (%) cannot be before the issue date (%)', v_due, v_issue
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', li.id::text,
           'description', li.service_name ||
             CASE WHEN COALESCE(li.description,'') <> '' THEN ' — ' || li.description ELSE '' END,
           'quantity', li.quantity,
           'unitPrice', li.unit_price,
           -- authoritative per-line amount, so no renderer has to recompute it
           'amount', li.amount) ORDER BY li.position), '[]'::jsonb)
    INTO v_lines FROM public.quote_line_items li WHERE li.quote_id = p_quote_id;

  IF v_setup THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'description', 'One-time setup fee',
      'quantity', 1, 'unitPrice', q.setup_fee, 'amount', q.setup_fee));
  END IF;

  SELECT COALESCE(SUM((e->>'amount')::numeric), 0) INTO v_subtotal
    FROM jsonb_array_elements(v_lines) e;
  v_tax   := round(v_subtotal * COALESCE(p_tax_percent, 0) / 100.0, 2);
  v_total := v_subtotal + v_tax;

  FOR v_attempt IN 1..8 LOOP
    BEGIN
      v_number := 'INV-' || lpad((floor(random() * 900000) + 100000)::bigint::text, 6, '0');
      v_key    := 'user_' || p_user_id::text || '_invoice_' || v_number;

      v_blob := jsonb_build_object(
        'id', v_key, 'userId', p_user_id, 'createdByEmail', p_email,
        'invoiceId', v_number,
        'issueDate', to_char(v_issue,'YYYY-MM-DD'), 'dueDate', to_char(v_due,'YYYY-MM-DD'),
        'clientName', q.client_name, 'clientAddress', COALESCE(q.client_address,''),
        'clientCity','', 'clientState','', 'clientZip','', 'clientCountry','United States',
        'lineItems', v_lines, 'taxPercent', COALESCE(p_tax_percent,0),
        'notes', COALESCE(p_notes,''),
        'subtotal', v_subtotal, 'tax', v_tax, 'total', v_total,
        'currency', COALESCE(q.currency,'USD'),
        'createdAt', now(),
        'sourceQuoteId', q.id, 'sourceQuoteNumber', q.quote_number,
        'servicePeriodStart', to_char(p_period_start,'YYYY-MM-DD'),
        'servicePeriodEnd', to_char(v_period_end,'YYYY-MM-DD'),
        'invoiceKind', v_kind);

      INSERT INTO public.kv_store_3c030652 (key, value) VALUES (v_key, v_blob);
      INSERT INTO public.quote_invoice_links
        (user_id, quote_id, invoice_key, invoice_number, service_period_start,
         service_period_end, invoice_kind, includes_setup_fee)
      VALUES (p_user_id, p_quote_id, v_key, v_number, p_period_start,
              v_period_end, v_kind, v_setup);

      RETURN jsonb_build_object('alreadyExists', false, 'invoice', v_blob);
    EXCEPTION WHEN unique_violation THEN
      -- Only an invoice-number clash is worth retrying. A period clash means a
      -- concurrent request won the race; anything else is a real fault.
      IF SQLERRM LIKE '%quote_invoice_links_unique_period%' THEN
        RETURN jsonb_build_object('alreadyExists', true, 'link',
          (SELECT to_jsonb(l) FROM public.quote_invoice_links l
            WHERE l.quote_id = p_quote_id AND l.service_period_start = p_period_start));
      END IF;
      IF v_attempt = 8 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_quote(uuid, uuid, date, date, date, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_quote(uuid, uuid, date, date, date, numeric, text, text)
  TO service_role;
