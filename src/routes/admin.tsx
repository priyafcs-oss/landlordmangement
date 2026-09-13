import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin — Landlord OS" }],
  }),
  component: AdminPage,
});

interface TenantRow {
  user_id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
  aliased_to_email: string | null;
  properties_count: number;
  tenants_count: number;
  total_rows: number;
}

/** Loosely typed handle for the same reason as db.ts's — the generated Database types won't know
 * about admin_list_tenants() until they're regenerated against the live schema. */
const rpc = supabase as unknown as {
  rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
};

function AdminPage() {
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    rpc.rpc("admin_list_tenants").then(({ data, error }) => {
      if (error) {
        console.error("[admin] failed to load tenants", error);
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      setRows((data as TenantRow[]) ?? []);
    });
  }, []);

  if (authorized === null) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">
          You don't have access to this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Every account that has signed up for this app, and roughly how much data each one has.
          Read-only — no other tenant's actual data is exposed here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Accounts ({rows?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Signed up</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Properties</th>
                <th className="py-2 pr-3">Tenants</th>
                <th className="py-2 pr-3">Total rows</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.user_id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{r.email}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("en-AU")}
                  </td>
                  <td className="py-2 pr-3">
                    {r.is_admin ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">Admin</span>
                    ) : r.aliased_to_email ? (
                      <span className="text-muted-foreground">Shares portfolio with {r.aliased_to_email}</span>
                    ) : (
                      <span className="text-muted-foreground">Landlord</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.properties_count}</td>
                  <td className="py-2 pr-3">{r.tenants_count}</td>
                  <td className="py-2 pr-3">{r.total_rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
