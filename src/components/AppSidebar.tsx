import { Link, useRouterState } from "@tanstack/react-router";
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
} from "@/components/ui/sidebar";
import { LayoutDashboard, Wallet, Wrench, Sparkles, Home, Settings, ClipboardCheck, FolderOpen, Users2, Receipt, ListOrdered, Coins, TrendingUp, ShieldCheck } from "lucide-react";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Assets", url: "/assets", icon: Coins },
  { title: "Entities", url: "/entities", icon: Users2 },
  { title: "Rental Hub", url: "/rental", icon: Wallet },
  { title: "Bills", url: "/bills", icon: Receipt },
  { title: "Transactions", url: "/transactions", icon: ListOrdered },
  { title: "Forecasts", url: "/forecasts", icon: TrendingUp },
  { title: "Buffers", url: "/buffers", icon: ShieldCheck },
  { title: "Inspections", url: "/inspections", icon: ClipboardCheck },
  { title: "Expenses", url: "/expenses", icon: Wrench },
  { title: "Documents", url: "/documents", icon: FolderOpen },
  { title: "AI Co-Pilot", url: "/copilot", icon: Sparkles },
  { title: "Settings", url: "/settings", icon: Settings },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <Sidebar collapsible="icon">
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
              {items.map((item) => (
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
