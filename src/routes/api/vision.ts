import { createFileRoute } from "@tanstack/react-router";

interface VisionBody {
  /** Base64 data URL of the inspection photo */
  image: string;
  /** Optional context, e.g. "Kitchen — Appliances" */
  context?: string;
}

export const Route = createFileRoute("/api/vision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const body = (await request.json()) as VisionBody;
        if (!body?.image || !body.image.startsWith("data:image/")) {
          return new Response("A base64 image data URL is required", { status: 400 });
        }
        if (body.image.length > 6_000_000) {
          return new Response("Image too large (max ~4MB)", { status: 413 });
        }

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content:
                  "You are an Australian property inspector. Describe the condition shown in the photo in ONE concise sentence (max 25 words) suitable as a draft condition report remark. Note visible damage, wear, cleanliness or hazards. No preamble.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: `Inspection item: ${body.context ?? "General"}` },
                  { type: "image_url", image_url: { url: body.image } },
                ],
              },
            ],
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          console.error(`[vision] gateway ${res.status}: ${text}`);
          return new Response(text || "AI vision error", { status: res.status });
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return new Response(JSON.stringify({ remark: data.choices?.[0]?.message?.content ?? "" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
