import { createFileRoute } from "@tanstack/react-router";

interface ChatBody {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}

export const Route = createFileRoute("/api/copilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const body = (await request.json()) as ChatBody;
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({
            model: "google/gemini-3.5-flash",
            messages: body.messages,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          return new Response(text || "AI error", { status: res.status });
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        return new Response(JSON.stringify({ content }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
