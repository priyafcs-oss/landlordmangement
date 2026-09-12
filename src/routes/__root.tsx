import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import { StoreProvider } from "@/lib/store";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/components/AuthGate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dashboard — Landlord OS" },
      { name: "description", content: "Portfolio wealth, cash flow and proactive compliance alerts." },
      { property: "og:title", content: "Dashboard — Landlord OS" },
      { property: "og:description", content: "Portfolio wealth, cash flow and proactive compliance alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Dashboard — Landlord OS" },
      { name: "twitter:description", content: "Portfolio wealth, cash flow and proactive compliance alerts." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isPublic = pathname.startsWith("/maintenance");
  // The public tenant maintenance-request form has no login of its own (see the matching RLS
  // migration's anon INSERT-only carve-out) — everything else requires a session.
  if (isPublic) {
    return (
      <QueryClientProvider client={queryClient}>
        <StoreProvider>
          <main className="min-h-screen bg-background">
            <Outlet />
          </main>
          {/* Bottom, not top — toasts stay on screen until dismissed (see sonner.tsx), and a wide/
              expanded dialog's own close button sits top-right too; stacking toasts there would
              grow to sit on top of it. Bottom-right avoids that entirely regardless of how many
              stack up. */}
          <Toaster richColors position="bottom-right" />
        </StoreProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* StoreProvider's initial data fetch only runs once, on mount — it must sit INSIDE
          AuthGate so it mounts fresh (and actually fetches) only once a session exists, rather
          than firing once pre-login (denied by RLS, silently empty) and never retrying after
          sign-in. */}
      <AuthGate>
        <StoreProvider>
          <SidebarProvider defaultOpen={false}>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <AppHeader />
              <main className="flex-1 overflow-x-hidden">
                <Outlet />
              </main>
            </SidebarInset>
          </SidebarProvider>
          <Toaster richColors position="bottom-right" />
        </StoreProvider>
      </AuthGate>
    </QueryClientProvider>
  );
}
