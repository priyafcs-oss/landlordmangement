import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { User } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Landlord OS" },
      { name: "description", content: "Manage your landlord profile and notification preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { state, updateLandlordProfile } = useStore();
  const [form, setForm] = useState(state.landlordProfile);

  useEffect(() => {
    setForm(state.landlordProfile);
  }, [state.landlordProfile]);

  const save = () => {
    updateLandlordProfile(form);
    toast.success("Profile saved");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your contact details are used for bill reminders, tenant notices and system alerts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Landlord Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="Email address">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="text-sm font-medium">Notification preferences</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Email notifications</div>
                <div className="text-xs text-muted-foreground">
                  Bill reminders and compliance alerts are prepared with your email pre-filled.
                </div>
              </div>
              <Switch
                checked={form.notifyEmail}
                onCheckedChange={(v) => setForm({ ...form, notifyEmail: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">SMS notifications</div>
                <div className="text-xs text-muted-foreground">
                  Reserved — will be used when SMS delivery is wired up.
                </div>
              </div>
              <Switch
                checked={form.notifySms}
                onCheckedChange={(v) => setForm({ ...form, notifySms: v })}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save}>Save profile</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
