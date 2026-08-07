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
      POST: async () => {
        return new Response("Vision integration disabled. Configure a different provider in this app.", {
          status: 501,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
