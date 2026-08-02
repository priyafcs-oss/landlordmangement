import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

type OAuthDetails = {
  client?: { name?: string; redirect_uri?: string } | null;
  scope?: string | null;
  redirect_url?: string;
  redirect_to?: string;
};

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
};

const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: the Supabase session lives in localStorage.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  head: () => ({
    meta: [
      { title: "Authorize access | Landlord's Compass" },
      { name: "description", content: "Approve or deny an external app's request to access your Landlord's Compass portfolio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsentPage,
});

function ConsentPage() {
  const { authorization_id: authorizationId } = Route.useSearch();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [details, setDetails] = useState<OAuthDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionEmail(data.session?.user?.email ?? null);
      setCheckingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionEmail(session?.user?.email ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionEmail || !authorizationId || details) return;
    setLoadingDetails(true);
    void oauth()
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoadingDetails(false));
  }, [sessionEmail, authorizationId, details]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauth();
    const { data, error: err } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (!authorizationId) {
    return <Shell><p className="text-sm text-muted-foreground">Missing authorization request. Start the connection again from the app you are connecting.</p></Shell>;
  }

  if (checkingSession) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
  }

  if (!sessionEmail) {
    return <Shell><SignIn onError={setError} error={error} /></Shell>;
  }

  const clientName = details?.client?.name ?? "an external app";

  return (
    <Shell>
      <CardHeader className="space-y-2 px-0">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-wide">Authorization request</span>
        </div>
        <CardTitle className="text-xl">Connect {clientName} to Landlord's Compass</CardTitle>
        <CardDescription>
          This lets {clientName} read your portfolio and use the app's tools as you, signed in as {sessionEmail}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {loadingDetails && <p className="text-sm text-muted-foreground">Loading request details…</p>}
        {details?.client?.redirect_uri && (
          <p className="text-xs text-muted-foreground break-all">Redirects to: {details.client.redirect_uri}</p>
        )}
        {details?.scope && <p className="text-xs text-muted-foreground">Requested scope: {details.scope}</p>}
        <p className="text-xs text-muted-foreground">
          This does not bypass this app's permissions or backend policies. You can disconnect at any time from the
          connected app.
        </p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex gap-3 pt-2">
          <Button disabled={busy} onClick={() => void decide(true)} className="flex-1">
            Approve
          </Button>
          <Button disabled={busy} variant="outline" onClick={() => void decide(false)} className="flex-1">
            Cancel connection
          </Button>
        </div>
      </CardContent>
    </Shell>
  );
}

function SignIn({ error, onError }: { error: string | null; onError: (m: string | null) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    setNotice(null);
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } });
    setBusy(false);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setNotice("Check your email to confirm your account, then return to this page.");
    }
  }

  async function google() {
    onError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.href,
    });
    if (result.error) onError(result.error.message);
  }

  return (
    <>
      <CardHeader className="space-y-2 px-0">
        <CardTitle className="text-xl">Sign in to authorize</CardTitle>
        <CardDescription>Sign in to your Landlord's Compass account to approve this connection.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <Button variant="outline" className="w-full" onClick={() => void google()}>
          Continue with Google
        </Button>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </CardContent>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md p-6">{children}</Card>
    </main>
  );
}
