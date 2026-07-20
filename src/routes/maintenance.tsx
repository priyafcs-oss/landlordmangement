import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Home, Wrench, Upload, CheckCircle2 } from "lucide-react";

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

const CATEGORIES = [
  "Plumbing",
  "Electrical",
  "Heating / Cooling",
  "Appliance",
  "Structural",
  "Pest",
  "Other",
];

function MaintenancePage() {
  const { state, addMaintenanceRequest } = useStore();
  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const properties = useMemo(() => state.properties, [state.properties]);

  const onPhoto = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 3 - photos.length);
    arr.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPhotos((p) => [...p, { name: f.name, data: String(reader.result) }]);
      };
      reader.readAsDataURL(f);
    });
  };

  const submit = () => {
    if (!propertyId) return toast.error("Please select your property");
    if (!category) return toast.error("Please select an issue category");
    if (!description.trim()) return toast.error("Please describe the issue");
    addMaintenanceRequest({
      propertyId,
      category,
      description: description.trim(),
      photos,
      contactName: contactName || undefined,
      contactPhone: contactPhone || undefined,
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
              Thanks — the landlord has been notified and will be in touch shortly.
            </p>
            <div className="pt-2">
              <Button variant="outline" onClick={() => { setSubmitted(false); setDescription(""); setPhotos([]); setCategory(""); }}>
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
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Home className="h-4 w-4" />
        <span>Tenant maintenance portal</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" /> Report a maintenance issue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Property</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select your rental property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Issue category</Label>
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
            <Label className="text-xs">Description</Label>
            <Textarea
              placeholder="Please describe the issue in detail..."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Your name (optional)</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone (optional)</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Photos (up to 3)</Label>
            <Input
              type="file"
              accept="image/*"
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
          <Button className="w-full gap-2" onClick={submit}>
            <Upload className="h-4 w-4" /> Submit request
          </Button>
          <div className="text-center text-xs text-muted-foreground">
            <Link to="/" className="underline">
              Landlord sign-in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
