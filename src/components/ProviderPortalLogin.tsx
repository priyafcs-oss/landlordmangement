import { useState } from "react";
import { Copy, ExternalLink, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import {
  getProviderPortalPassword,
  setProviderPortalPassword,
  clearProviderPortalPassword,
} from "@/lib/db";

/**
 * Genuine encrypted password storage for a provider's login portal (see
 * setProviderPortalPassword/getProviderPortalPassword in db.ts and the Vault migration those
 * wrap) — distinct from the plain "Password note" hint field above it. The decrypted value is
 * only ever fetched on an explicit "Reveal" click, into this component's own local state; it's
 * never part of AppState/localStorage the way every other field on this dialog is.
 */
export function ProviderPortalPasswordField({
  providerId,
  hasPassword,
}: {
  providerId: string;
  hasPassword: boolean;
}) {
  const { refreshOne } = useStore();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    setBusy(true);
    try {
      const pw = await getProviderPortalPassword(providerId);
      if (pw === null) {
        toast.error("No password stored");
      } else {
        setRevealed(pw);
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!newPassword) return toast.error("Enter a password first");
    setBusy(true);
    try {
      const ok = await setProviderPortalPassword(providerId, newPassword);
      if (ok) {
        toast.success("Password saved, encrypted");
        setEditing(false);
        setNewPassword("");
        setRevealed(null);
        await refreshOne("providers", providerId);
      } else {
        toast.error("Couldn't save password");
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Remove the stored password for this provider?")) return;
    setBusy(true);
    try {
      const ok = await clearProviderPortalPassword(providerId);
      if (ok) {
        toast.success("Password removed");
        setRevealed(null);
        await refreshOne("providers", providerId);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label="Portal password (encrypted)">
      {editing ? (
        <div className="flex items-center gap-1">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="flex-1"
          />
          <Button size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setNewPassword("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {revealed ? (
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs">{revealed}</span>
          ) : hasPassword ? (
            <Button size="sm" variant="outline" onClick={reveal} disabled={busy}>
              Reveal
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">No password stored</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {hasPassword ? "Change" : "Set password"}
          </Button>
          {hasPassword && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={clear}
              disabled={busy}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

const copy = async (text: string, what: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error(`Couldn't copy the ${what.toLowerCase()}`);
  }
};

/** Sits next to an emailed bill's "Open bill" link — the provider's portal login with copy
 * buttons, so logging in to fetch the PDF doesn't mean hunting for the details. The password goes
 * straight from Vault to the clipboard, never onto the screen. With nothing saved yet, offers to
 * save both here (password encrypted, same as the Providers page). */
export function ProviderPortalLogin({
  providerId,
  billUrl,
}: {
  providerId?: string;
  billUrl?: string;
}) {
  const { state, updateProvider, refreshOne } = useStore();
  const provider = providerId ? state.providers.find((p) => p.id === providerId) : undefined;
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const copyPassword = async () => {
    if (!provider) return;
    setBusy(true);
    try {
      const pw = await getProviderPortalPassword(provider.id);
      if (pw === null) toast.error("No password stored");
      else await copy(pw, "Password");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!provider) return;
    if (!username.trim() && !password) return toast.error("Enter a username or password");
    setBusy(true);
    try {
      if (username.trim()) updateProvider(provider.id, { portalUsername: username.trim() });
      if (password && !(await setProviderPortalPassword(provider.id, password)))
        return toast.error("Couldn't save password");
      if (password) await refreshOne("providers", provider.id);
      toast.success("Login saved");
      setEditing(false);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const hasLogin = !!(provider?.portalUsername || provider?.portalPasswordSecretId);

  return (
    <div className="space-y-2 rounded-md border bg-background p-2 text-xs">
      {billUrl && (
        <Button asChild size="sm" className="w-full gap-1">
          <a href={billUrl} target="_blank" rel="noreferrer">
            Open bill{provider ? ` on ${provider.name}` : ""} <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      )}
      {provider && !editing && hasLogin && (
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-3 w-3 text-muted-foreground" />
          {provider.portalUsername && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => copy(provider.portalUsername!, "Username")}
            >
              <Copy className="h-3 w-3" /> {provider.portalUsername}
            </Button>
          )}
          {provider.portalPasswordSecretId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={copyPassword}
              disabled={busy}
            >
              <Copy className="h-3 w-3" /> Copy password
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setUsername(provider.portalUsername ?? "");
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </div>
      )}
      {provider && !editing && !hasLogin && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={() => setEditing(true)}
        >
          <KeyRound className="h-3 w-3" /> Save your {provider.name} login here
        </Button>
      )}
      {provider && editing && (
        <div className="space-y-1">
          <Input
            className="h-7 text-xs"
            placeholder="Username / email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            className="h-7 text-xs"
            type="password"
            placeholder={
              provider.portalPasswordSecretId
                ? "New password (leave blank to keep)"
                : "Password (stored encrypted)"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={busy}>
              Save login
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {billUrl && (
        <div className="text-muted-foreground">
          1. Open bill and log in · 2. Download the PDF · 3. Drop it in the box above to attach and
          split it
        </div>
      )}
    </div>
  );
}
