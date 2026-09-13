import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Home, Eye, EyeOff } from "lucide-react";

/**
 * Gates the landlord app behind a real Supabase Auth session. Every table's RLS policy now scopes
 * to `owner_id = auth.uid()` (see 20260913100000_multi_tenant_owner_scoping.sql) — this is the
 * client-side half: without a session, nothing renders except the sign-in form, and no data
 * request even fires.
 *
 * Self-serve sign-up is enabled: each new account gets its own completely separate, empty
 * portfolio (owner-scoped RLS means a new user simply can't see anyone else's rows), so there's no
 * privilege-escalation risk in letting anyone create one. Sign-in is also guarded by a server-side
 * lockout (see login_lockout migration) — 5 failed attempts for an email blocks further tries on
 * it for 5 minutes, enforced in the database so it can't be bypassed by clearing local storage.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <>{children}</>;
}

/** The generated Database types won't know about these RPCs until they're regenerated against
 * the live schema post-migration — same reasoning as db.ts's loosely typed `db` handle. */
const authRpc = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

async function checkLockout(email: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const { data, error } = await authRpc.rpc("check_login_lockout", { p_email: email });
  if (error) {
    console.error("[auth] lockout check failed", error);
    return { locked: false, retryAfterSeconds: 0 };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { locked?: boolean; retry_after_seconds?: number }
    | null
    | undefined;
  return { locked: !!row?.locked, retryAfterSeconds: row?.retry_after_seconds ?? 0 };
}

/** Exported for reuse by the "Account & Security" section of Settings (change password). */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  onEnter?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          className="pr-9"
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");

  const signIn = async () => {
    if (!email || !password) return toast.error("Enter your email and password");
    setBusy(true);
    try {
      const lockout = await checkLockout(email);
      if (lockout.locked) {
        const minutes = Math.max(1, Math.ceil(lockout.retryAfterSeconds / 60));
        toast.error(`Too many failed attempts — try again in ${minutes} minute${minutes === 1 ? "" : "s"}`);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        void authRpc.rpc("record_login_failure", { p_email: email });
        toast.error("Incorrect email or password");
        return;
      }
      void authRpc.rpc("clear_login_failures", { p_email: email });
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    if (!email || !password) return toast.error("Enter your email and password");
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Account created — check your email to confirm, then sign in");
    setMode("signin");
  };

  const sendReset = async () => {
    if (!email) return toast.error("Enter your email first");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password reset email sent — check your inbox");
    setMode("signin");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Home className="h-4 w-4" />
            </div>
            Landlord OS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "signin" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                onEnter={signIn}
              />
              <Button className="w-full gap-2" disabled={busy} onClick={signIn}>
                <Lock className="h-4 w-4" /> Sign in
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => setMode("reset")}
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => setMode("signup")}
                >
                  Create account
                </button>
              </div>
            </>
          )}
          {mode === "signup" && (
            <>
              <p className="text-xs text-muted-foreground">
                Create your own account — your properties, tenants and finances stay completely
                private to you, separate from any other landlord using this app.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                onEnter={signUp}
              />
              <Button className="w-full" disabled={busy} onClick={signUp}>
                Create account
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={() => setMode("signin")}
              >
                Back to sign in
              </button>
            </>
          )}
          {mode === "reset" && (
            <>
              <p className="text-xs text-muted-foreground">
                Enter your email and we'll send you a link to reset your password.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <Button className="w-full" disabled={busy} onClick={sendReset}>
                Send reset link
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={() => setMode("signin")}
              >
                Back to sign in
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
