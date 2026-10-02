-- Migration: Mobile push device pairing and subscriptions
-- Date: 2026-10-02

CREATE TABLE IF NOT EXISTS public.mobile_push_pairing_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    device_info TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pairing_tokens_token ON public.mobile_push_pairing_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_user_id ON public.mobile_push_pairing_tokens(user_id);

CREATE TABLE IF NOT EXISTS public.mobile_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT,
    auth TEXT,
    device_name TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON public.mobile_push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint ON public.mobile_push_subscriptions(endpoint);

-- Enable RLS
ALTER TABLE public.mobile_push_pairing_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies for mobile_push_pairing_tokens
CREATE POLICY "Users can create their own pairing tokens"
ON public.mobile_push_pairing_tokens FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own pairing tokens"
ON public.mobile_push_pairing_tokens FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Anyone can lookup unexpired pairing token"
ON public.mobile_push_pairing_tokens FOR SELECT
TO anon, authenticated
USING (expires_at > now() AND used_at IS NULL);

CREATE POLICY "Anyone with valid token can mark as used"
ON public.mobile_push_pairing_tokens FOR UPDATE
TO anon, authenticated
USING (expires_at > now() AND used_at IS NULL)
WITH CHECK (used_at IS NOT NULL);

-- Policies for mobile_push_subscriptions
CREATE POLICY "Users can view and delete their own subscriptions"
ON public.mobile_push_subscriptions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow public insert of subscriptions via valid token"
ON public.mobile_push_subscriptions FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- RPC for verifying and consuming pairing token with push subscription
CREATE OR REPLACE FUNCTION public.pair_mobile_device(
    target_token TEXT,
    target_endpoint TEXT,
    target_p256dh TEXT,
    target_auth TEXT,
    target_device_name TEXT,
    target_user_agent TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    token_record RECORD;
    user_profile RECORD;
    sub_id UUID;
BEGIN
    -- Look up token
    SELECT * INTO token_record
    FROM public.mobile_push_pairing_tokens
    WHERE token = target_token
      AND expires_at > now()
      AND used_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Token ไม่ถูกต้อง หรือหมดอายุแล้ว');
    END IF;

    -- Look up user profile
    SELECT id, full_name, employee_id, email INTO user_profile
    FROM public.profiles
    WHERE id = token_record.user_id;

    -- Upsert push subscription
    INSERT INTO public.mobile_push_subscriptions (
        user_id, endpoint, p256dh, auth, device_name, user_agent, last_used_at
    )
    VALUES (
        token_record.user_id,
        target_endpoint,
        target_p256dh,
        target_auth,
        target_device_name,
        target_user_agent,
        now()
    )
    ON CONFLICT (endpoint) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        device_name = EXCLUDED.device_name,
        user_agent = EXCLUDED.user_agent,
        last_used_at = now()
    RETURNING id INTO sub_id;

    -- Mark pairing token as used
    UPDATE public.mobile_push_pairing_tokens
    SET used_at = now(),
        device_info = target_device_name
    WHERE id = token_record.id;

    RETURN jsonb_build_object(
        'success', true,
        'subscription_id', sub_id,
        'user_name', user_profile.full_name,
        'employee_id', user_profile.employee_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pair_mobile_device TO anon, authenticated;
