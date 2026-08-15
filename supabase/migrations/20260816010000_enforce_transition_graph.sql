-- Enforce the status transition graph in the database.
--
-- ALLOWED_TRANSITIONS in src/app/types/quote.ts carried a comment saying "the
-- server enforces this too", and it did not: transition_quote_status rejected
-- an unknown target, 'expired', a stale expectedStatus and an invoiced quote,
-- but never checked from->to. So PATCH .../status { to: "draft" } on an
-- accepted quote succeeded, silently reopening a document the client had
-- agreed to. The UI list was the only thing stopping it, which is not a control.
--
-- Accepted and declined are terminal here on purpose. Reopening a decided quote
-- should be an explicit, audited act — create a revision instead.

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
    FROM public.quotes
   WHERE id = p_quote_id AND user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected IS NOT NULL AND p_expected <> v_from THEN
    RAISE EXCEPTION 'quote status changed to % since it was loaded', v_from
      USING ERRCODE = '40001';
  END IF;

  -- Setting a quote to the status it already has is a no-op, not an error:
  -- a double-click should not fail.
  IF p_to = v_from THEN
    RETURN (
      SELECT to_jsonb(q) || jsonb_build_object(
        'effective_status', public.quote_effective_status(q.status, q.valid_until))
        FROM public.quotes q WHERE q.id = p_quote_id
    );
  END IF;

  v_allowed := CASE v_from
    WHEN 'draft'    THEN ARRAY['sent','accepted','declined']
    WHEN 'sent'     THEN ARRAY['accepted','declined','draft']
    WHEN 'accepted' THEN ARRAY[]::text[]
    WHEN 'declined' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to = ANY (v_allowed)) THEN
    IF v_from IN ('accepted','declined') THEN
      RAISE EXCEPTION
        'a % quote cannot be moved to %; create a revision instead', v_from, p_to
        USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'cannot move a quote from % to %', v_from, p_to
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_invoices
    FROM public.quote_invoice_links WHERE quote_id = p_quote_id;
  IF v_invoices > 0 THEN
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

REVOKE ALL ON FUNCTION public.transition_quote_status(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_quote_status(uuid, uuid, text, text, text)
  TO service_role;
