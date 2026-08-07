import { createFileRoute } from "@tanstack/react-router";

interface ChatBody {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}

export const Route = createFileRoute("/api/copilot")({
  server: {
    handlers: {
      POST: async () => {
        return new Response("AI integration disabled. Configure a different provider in this app.", {
          status: 501,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
