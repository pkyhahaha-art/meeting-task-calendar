-- Phones verify the exact scanned token via RPC without signing in.
-- Apply after 202610020003_mobile_push_device_pairing.sql.
BEGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON public.mobile_push_pairing_tokens TO authenticated;
GRANT SELECT, DELETE ON public.mobile_push_subscriptions TO authenticated;

-- Token lookup and consumption go through SECURITY DEFINER functions only.
-- Never expose the list of active tokens to unauthenticated phones.
DROP POLICY IF EXISTS "Anyone can lookup unexpired pairing token" ON public.mobile_push_pairing_tokens;
DROP POLICY IF EXISTS "Anyone with valid token can mark as used" ON public.mobile_push_pairing_tokens;
DROP POLICY IF EXISTS "Allow public insert of subscriptions via valid token" ON public.mobile_push_subscriptions;
REVOKE ALL ON public.mobile_push_pairing_tokens FROM anon;
REVOKE ALL ON public.mobile_push_subscriptions FROM anon;

CREATE OR REPLACE FUNCTION public.verify_mobile_pairing_token(target_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.mobile_push_pairing_tokens
        WHERE token = target_token AND expires_at > now() AND used_at IS NULL
    ) THEN
        RETURN jsonb_build_object('valid', true);
    END IF;
    RETURN jsonb_build_object('valid', false, 'error', 'QR Code ไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาสร้าง QR Code ใหม่');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_mobile_pairing_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_mobile_pairing_token(TEXT) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
