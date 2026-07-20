import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, User, Bot } from "lucide-react";
import { buildTenantLedger, fmtCurrency, daysUntil } from "@/lib/calculations";
import { toast } from "sonner";

export const Route = createFileRoute("/copilot")({
  head: () => ({
    meta: [
      { title: "AI Co-Pilot — Landlord OS" },
      { name: "description", content: "Ask AI about arrears, notices, yields and upcoming tasks." },
    ],
  }),
  component: CopilotPage,
});

const SUGGESTIONS = [
  "Who is in arrears right now?",
  "Show my highest yielding property",
  "What are my upcoming tasks?",
  "Draft an overdue notice for a tenant",
];

interface Msg {
  role: "user" | "assistant";
  content: string;
}

function CopilotPage() {
  const { state } = useStore();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi — I have full context of your portfolio. Ask me about arrears, yields, upcoming lease renewals, warranties, or draft a tenant notice.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const buildContext = () => {
    const tenantsSummary = state.tenants.map((t) => {
      const prop = state.properties.find((p) => p.id === t.propertyId);
      const { total, outstandingRent, outstandingInvoices } = buildTenantLedger(t, state.ledger, state.invoices);
      return {
        name: t.name,
        property: prop?.address,
        rent: `${t.rentAmount} ${t.rentFrequency}`,
        leaseExpiry: t.leaseExpiry || "Periodic",
        daysUntilExpiry: t.leaseExpiry ? daysUntil(t.leaseExpiry) : null,
        paidUpToDate: t.paidUpToDate,
        totalOwing: total,
        rentArrears: outstandingRent,
        invoicesOutstanding: outstandingInvoices,
        inArrears: total > 0.01,
      };
    });
    const propertiesSummary = state.properties.map((p) => {
      const tenants = state.tenants.filter((t) => t.propertyId === p.id);
      const annualRent = tenants.reduce((s, t) => {
        const mult = t.rentFrequency === "Weekly" ? 52 : t.rentFrequency === "Fortnightly" ? 26 : 12;
        return s + t.rentAmount * mult;
      }, 0);
      const yieldPct = p.purchasePrice ? (annualRent / p.purchasePrice) * 100 : 0;
      const loan = state.loans.find((l) => l.propertyId === p.id);
      return {
        address: p.address,
        purchasePrice: p.purchasePrice,
        currentValue: p.currentValue,
        loanBalance: loan?.totalBalance ?? 0,
        annualRentEstimate: annualRent,
        grossYieldPct: yieldPct,
      };
    });
    const warrantiesSoon = state.expenses
      .filter((e) => e.hasWarranty && e.warrantyExpiry && daysUntil(e.warrantyExpiry) <= 90 && daysUntil(e.warrantyExpiry) >= 0)
      .map((e) => ({ item: e.itemName, expires: e.warrantyExpiry }));
    const leasesSoon = state.tenants
      .filter((t) => !!t.leaseExpiry && daysUntil(t.leaseExpiry) <= 60 && daysUntil(t.leaseExpiry) >= 0)
      .map((t) => ({ tenant: t.name, expires: t.leaseExpiry }));
    return { tenants: tenantsSummary, properties: propertiesSummary, warrantiesSoon, leasesSoon };
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const newMsgs = [...messages, { role: "user" as const, content: text }];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    const context = buildContext();
    const systemPrompt = `You are the AI co-pilot for an Australian independent landlord. You have full context of their portfolio (below as JSON). Answer questions concisely and accurately using this data. When asked for arrears, list tenants with amounts. When asked for yields, compute gross yield = (annual rent / purchase price) * 100. When asked to draft notices, write in a professional Australian tone integrating exact data.

PORTFOLIO_JSON:
${JSON.stringify(context, null, 2)}`;

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            ...newMsgs.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      if (res.status === 429) {
        toast.error("Rate limit reached. Try again in a moment.");
        setLoading(false);
        return;
      }
      if (res.status === 402) {
        toast.error("AI credits exhausted. Add credits in workspace billing.");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { content: string };
      setMessages((m) => [...m, { role: "assistant", content: data.content }]);
    } catch (err) {
      toast.error("AI request failed");
      console.error(err);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 100);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" /> AI Co-Pilot
        </h1>
        <p className="text-sm text-muted-foreground">Portfolio-aware assistant with live data context.</p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <Badge
            key={s}
            variant="outline"
            className="cursor-pointer px-3 py-1.5 text-xs hover:bg-accent"
            onClick={() => send(s)}
          >
            {s}
          </Badge>
        ))}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pr-2">
            {messages.map((m, i) => (
              <div key={i} className={"flex gap-3 " + (m.role === "user" ? "flex-row-reverse" : "")}>
                <div
                  className={
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full " +
                    (m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")
                  }
                >
                  {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>
                <div
                  className={
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm " +
                    (m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-muted">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">Thinking…</div>
              </div>
            )}
          </div>

          <div className="flex gap-2 border-t pt-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about your portfolio…"
              className="min-h-[44px] max-h-[120px] resize-none"
            />
            <Button onClick={() => send(input)} disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
