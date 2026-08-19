import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { User, ShieldAlert, Lock, LogOut } from "lucide-react";
import { toast } from "sonner";
import { TenantPortal } from "./TenantPortal";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";

export function AppHeader() {
  const { state } = useStore();
  const [tenantView, setTenantView] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<string>(state.tenants[0]?.id ?? "");

  if (tenantView && selectedTenant) {
    return (
      <>
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <User className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold">Tenant Portal</div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedTenant} onValueChange={setSelectedTenant}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tenant view</span>
              <Switch checked={tenantView} onCheckedChange={setTenantView} />
            </div>
          </div>
        </header>
        <TenantPortal tenantId={selectedTenant} />
      </>
    );
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <div className="hidden truncate text-sm font-medium sm:block">Landlord Operating System</div>
      </div>
      <div className="flex items-center gap-2">
        <UploadDocumentDialog />
        <AiBudgetBadge />
        <CreatorMasterPanel />

        {state.tenants.length > 0 && (
          <>
            <Select value={selectedTenant || state.tenants[0]?.id} onValueChange={setSelectedTenant}>
              <SelectTrigger className="h-8 w-[130px] sm:w-[160px]">
                <SelectValue placeholder="Tenant" />
              </SelectTrigger>
              <SelectContent>
                {state.tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 rounded-md border px-2 py-1">
              <span className="hidden text-xs text-muted-foreground sm:inline">Tenant view</span>
              <Switch
                checked={tenantView}
                onCheckedChange={(v) => {
                  if (v && !selectedTenant) setSelectedTenant(state.tenants[0].id);
                  setTenantView(v);
                }}
              />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function AiBudgetBadge() {
  const { state } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const used = state.aiConfig.countDate === today ? state.aiConfig.dailyCount : 0;
  const blocked = !state.aiConfig.enabled || used >= state.aiConfig.dailyLimit;
  return (
    <div
      className={
        "hidden items-center gap-1 rounded-md border px-2 py-1 text-xs sm:flex " +
        (blocked ? "border-destructive text-destructive" : "text-muted-foreground")
      }
      title={
        !state.aiConfig.enabled
          ? "AI disabled from Creator Master Panel"
          : blocked
            ? "Daily AI Budget Limit Reached"
            : "AI requests used today"
      }
    >
      {!state.aiConfig.enabled ? <ShieldAlert className="h-3 w-3" /> : null}
      AI {used}/{state.aiConfig.dailyLimit}
    </div>
  );
}

function CreatorMasterPanel() {
  const { state, setAiEnabled, resetAiUsage } = useStore();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);

  const submit = () => {
    if (pin === "8888") {
      setAuthed(true);
      toast.success("Creator access unlocked");
    } else {
      toast.error("Wrong PIN");
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const used = state.aiConfig.countDate === today ? state.aiConfig.dailyCount : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPin("");
          setAuthed(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Creator Master Panel" className="h-8 w-8">
          <Lock className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Creator Master Panel</DialogTitle>
        </DialogHeader>
        {!authed ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Enter the creator PIN to manage the AI budget firewall and master kill switch.
            </p>
            <Label className="text-xs">PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <Button className="w-full" onClick={submit}>
              Unlock
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="text-sm font-medium">AI Co-Pilot APIs</div>
                <div className="text-xs text-muted-foreground">
                  Master kill switch. When disabled, no AI request will ever leave this app.
                </div>
              </div>
              <Switch checked={state.aiConfig.enabled} onCheckedChange={setAiEnabled} />
            </div>
            <div className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Daily budget</div>
                  <div className="text-xs text-muted-foreground">
                    Hard cap of {state.aiConfig.dailyLimit} AI calls per day (resets at midnight).
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold">
                    {used}
                    <span className="text-xs text-muted-foreground">/{state.aiConfig.dailyLimit}</span>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  resetAiUsage();
                  toast.success("Daily AI counter reset");
                }}
              >
                Reset today's counter
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
