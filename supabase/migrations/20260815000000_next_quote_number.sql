-- Expose the quote-number allocation so the editor can show the number a save
-- would assign, instead of the vaguer "Assigned on save".
--
-- A forward migration rather than an edit to 20260814000000: that one is already
-- applied, and CREATE TABLE IF NOT EXISTS would not have re-run anyway.
--
-- save_quote is repointed at this function in the same migration, so the number
-- previewed and the number allocated come from one definition and cannot drift.
-- It is only a preview: the authoritative allocation still happens inside
-- save_quote's retry loop, under the UNIQUE(user_id, quote_number) constraint.

CREATE OR REPLACE FUNCTION public.next_quote_number(
  p_user_id uuid,
  p_offset  int DEFAULT 1
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'UP-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
         (CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END)
  FROM (
    SELECT COALESCE(MAX((regexp_replace(quote_number, '^.*-', ''))::bigint), 0)
           + GREATEST(p_offset, 1) AS n
      FROM public.quotes
     WHERE user_id = p_user_id
       AND quote_number ~ ('^UP-' || to_char(CURRENT_DATE, 'YYYY') || '-[0-9]{1,15}$')
  ) t;
$$;

REVOKE ALL ON FUNCTION public.next_quote_number(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_quote_number(uuid, int) TO service_role;

-- Repoint save_quote's inline allocation at the shared function.
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
    PERFORM 1 FROM public.quotes
     WHERE id = p_quote_id AND user_id = p_user_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_attempt IN 1..8 LOOP
    BEGIN
      IF v_allocate THEN
        v_number := public.next_quote_number(p_user_id, v_attempt);
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
          0, v_setup_fee, 0,
          COALESCE(p_quote->'scope_groups', '[]'::jsonb),
          COALESCE(p_quote->'included', '[]'::jsonb),
          COALESCE(p_quote->'excluded', '[]'::jsonb),
          p_quote->>'assumptions_note', p_quote->>'notes'
        ) RETURNING id INTO v_id;
      ELSE
        UPDATE public.quotes SET
          quote_number         = CASE WHEN v_supplied THEN v_number ELSE quote_number END,
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
      IF NOT v_allocate OR v_attempt = 8 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

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
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
       WITH ORDINALITY AS t(it, ord);

  SELECT COALESCE(SUM(amount), 0) INTO v_subtotal
    FROM public.quote_line_items WHERE quote_id = v_id;

  UPDATE public.quotes
     SET subtotal = v_subtotal, total_monthly = v_subtotal
   WHERE id = v_id;

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

REVOKE ALL ON FUNCTION public.save_quote(uuid, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quote(uuid, text, jsonb, jsonb, uuid)
  TO service_role;
