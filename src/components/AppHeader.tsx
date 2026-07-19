import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { TenantPortal } from "./TenantPortal";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function AppHeader() {
  const { state, reset } = useStore();
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

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear Sample Data</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Wipe all data?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes every property, tenant, ledger entry, invoice, expense and inspection from
                local storage. Use this to start fresh with your own data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  reset();
                  toast.success("All data cleared");
                }}
              >
                Clear everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </header>
  );
}
