-- Server-side login lockout: 5 failed attempts for a given email blocks further tries for 5
-- minutes, enforced here (not just client-side) so it can't be bypassed by clearing browser
-- storage. login_attempts has no policies at all — it's reachable only through the three
-- SECURITY DEFINER functions below, which is deliberate: they're the only pre-login surface this
-- migration exposes to anon.

CREATE TABLE public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON public.login_attempts (email, attempted_at);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_login_lockout(p_email text)
RETURNS TABLE(locked boolean, retry_after_seconds int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  recent_count int;
  oldest_attempt timestamptz;
BEGIN
  SELECT count(*), min(attempted_at) INTO recent_count, oldest_attempt
  FROM public.login_attempts
  WHERE email = lower(p_email) AND attempted_at > now() - interval '5 minutes';

  IF recent_count >= 5 THEN
    RETURN QUERY SELECT true, GREATEST(0, 300 - EXTRACT(EPOCH FROM (now() - oldest_attempt))::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_login_failure(p_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.login_attempts (email) VALUES (lower(p_email));
  -- Opportunistic cleanup instead of a cron job — every failed login sweeps out attempts old
  -- enough that no lockout window could still care about them.
  DELETE FROM public.login_attempts WHERE attempted_at < now() - interval '1 hour';
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_login_failures(p_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.login_attempts WHERE email = lower(p_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_login_lockout(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_failure(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_login_failures(text) TO anon, authenticated;
