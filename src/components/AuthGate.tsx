import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Home } from "lucide-react";

/**
 * Gates the landlord app behind a real Supabase Auth session. Every table's RLS policy now
 * requires `authenticated` (see the require_auth migration) — this is the client-side half:
 * without a session, nothing renders except the sign-in form, and no data request even fires.
 *
 * Sign-in only, deliberately no self-serve sign-up here: with RLS currently granting any
 * authenticated user full access (per-landlord row scoping is a later phase), an open sign-up
 * form would let anyone who finds it create an account and get full access. Accounts are created
 * by the project owner via the Supabase dashboard (Authentication → Users → Add user).
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

function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "reset">("signin");

  const signIn = async () => {
    if (!email || !password) return toast.error("Enter your email and password");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
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
          {mode === "signin" ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                />
              </div>
              <Button className="w-full gap-2" disabled={busy} onClick={signIn}>
                <Lock className="h-4 w-4" /> Sign in
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={() => setMode("reset")}
              >
                Forgot password?
              </button>
            </>
          ) : (
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
