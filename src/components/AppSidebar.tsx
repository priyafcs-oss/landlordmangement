import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { LayoutDashboard, Wallet, Sparkles, Home, Settings, ClipboardCheck, Users2, Coins, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Bills, Transactions, Forecasts, Buffers and Documents are all reachable from the Assets
// left-nav now (assets.tsx) — same reasoning as Portfolio Manager's removal: one way in, not a
// separate sidebar entry per underlying route.
const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Assets", url: "/assets", icon: Coins },
  { title: "Entities", url: "/entities", icon: Users2 },
  { title: "Rental Hub", url: "/rental", icon: Wallet },
  { title: "Inspections", url: "/inspections", icon: ClipboardCheck },
  { title: "AI Assistant", url: "/copilot", icon: Sparkles },
  { title: "Settings", url: "/settings", icon: Settings },
] as const;

/** Loosely typed handle for the same reason as db.ts's — the generated Database types won't know
 * about is_platform_admin() until they're regenerated against the live schema. */
const rpc = supabase as unknown as {
  rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
};

function useIsPlatformAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    rpc.rpc("is_platform_admin").then(({ data, error }) => {
      if (!error) setIsAdmin(!!data);
    });
  }, []);
  return isAdmin;
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { setOpen, isMobile } = useSidebar();
  const isAdmin = useIsPlatformAdmin();
  const menuItems = isAdmin ? [...items, { title: "Admin", url: "/admin", icon: ShieldCheck }] : items;
  return (
    <Sidebar
      collapsible="icon"
      onMouseEnter={() => !isMobile && setOpen(true)}
      onMouseLeave={() => !isMobile && setOpen(false)}
    >
      <SidebarHeader className="px-3 pt-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Home className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Landlord OS</div>
            <div className="truncate text-xs text-muted-foreground">Portfolio &amp; Compliance</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname === item.url}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
