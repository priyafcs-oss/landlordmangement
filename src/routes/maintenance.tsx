import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Home, Wrench, Upload, CheckCircle2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/maintenance")({
  head: () => ({
    meta: [
      { title: "Report a maintenance issue" },
      { name: "description", content: "Submit a maintenance request for your rental property." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MaintenancePage,
});

const CATEGORIES = ["Plumbing", "Electrical", "Heating / Cooling", "Appliance", "Structural", "Pest", "Other"];

function MaintenancePage() {
  const { state, addMaintenanceRequest } = useStore();
  const [addressOrCode, setAddressOrCode] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<"Low" | "Medium" | "High">("Medium");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>([]);
  const [video, setVideo] = useState<{ name: string; data: string } | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);

  const resolvePropertyId = useMemo(() => {
    return (input: string) => {
      const q = input.trim().toLowerCase();
      if (!q) return undefined;
      // Exact tenant code first
      const byCode = state.properties.find((p) => p.tenantCode?.toLowerCase() === q);
      if (byCode) return byCode.id;
      // Substring match on address
      const byAddr = state.properties.find((p) => p.address.toLowerCase().includes(q));
      return byAddr?.id;
    };
  }, [state.properties]);

  const onPhoto = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 3 - photos.length);
    arr.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setPhotos((p) => [...p, { name: f.name, data: String(reader.result) }]);
      reader.readAsDataURL(f);
    });
  };
  const onVideo = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast.error("Video must be under 15MB");
    const reader = new FileReader();
    reader.onload = () => setVideo({ name: f.name, data: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const validPhone = (v: string) => v.replace(/\D/g, "").length >= 8;

  const submit = () => {
    if (!addressOrCode.trim()) return toast.error("Please enter your property address or tenant code");
    if (!contactName.trim()) return toast.error("Name is required");
    if (!validPhone(contactPhone)) return toast.error("Valid phone number is required");
    if (!validEmail(contactEmail)) return toast.error("Valid email is required");
    if (!category) return toast.error("Please select an issue category");
    if (!description.trim()) return toast.error("Please describe the issue");
    addMaintenanceRequest({
      propertyId: resolvePropertyId(addressOrCode),
      propertyAddressTyped: addressOrCode.trim(),
      category,
      description: description.trim(),
      urgency,
      photos,
      video,
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      contactEmail: contactEmail.trim(),
    });
    setSubmitted(true);
    toast.success("Maintenance request submitted");
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <div className="text-lg font-semibold">Request received</div>
            <p className="text-sm text-muted-foreground">
              Thanks — your landlord has been notified and will be in touch shortly.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSubmitted(false);
                  setDescription("");
                  setPhotos([]);
                  setVideo(undefined);
                  setCategory("");
                }}
              >
                Submit another request
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Home className="h-4 w-4" />
        <span>Tenant maintenance portal</span>
      </div>
      <div className="mb-4 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <span>
          For your privacy and ours, we don't show a list of managed properties. Please type your rental address exactly
          as it appears on your lease, or the short tenant code your landlord gave you.
        </span>
      </div>
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Report a maintenance issue</h1>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Property address or tenant code *</Label>
            <Input
              placeholder="e.g. 12 Rosewood Ave, Bondi — or ROSE12"
              value={addressOrCode}
              onChange={(e) => setAddressOrCode(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Your name *</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone *</Label>
              <Input inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Email *</Label>
              <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Issue category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Urgency *</Label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as typeof urgency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low — no rush</SelectItem>
                  <SelectItem value="Medium">Medium — a few days</SelectItem>
                  <SelectItem value="High">High — urgent / unsafe</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description *</Label>
            <Textarea
              placeholder="Please describe the issue in detail..."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Photos (up to 3)</Label>
            <Input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              disabled={photos.length >= 3}
              onChange={(e) => onPhoto(e.target.files)}
            />
            {photos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.data} alt={p.name} className="h-16 w-16 rounded object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((ps) => ps.filter((_, idx) => idx !== i))}
                      className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Short video (optional, ≤ 15MB)</Label>
            <Input
              type="file"
              accept="video/*"
              capture="environment"
              onChange={(e) => onVideo(e.target.files?.[0])}
            />
            {video && <div className="mt-1 text-xs text-muted-foreground">🎬 {video.name}</div>}
          </div>

          <Button className="w-full gap-2" onClick={submit}>
            <Upload className="h-4 w-4" /> Submit request
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
