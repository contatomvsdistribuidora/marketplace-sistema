import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  Package,
  Upload,
  ScrollText,
  Settings,
  LogOut,
  PanelLeft,
  Store,
  Bot,
  Link2,
  Send,
  Music,
  FolderTree,
  History,
  Clock,
  ShoppingCart,
  ShoppingBag,
  FileSpreadsheet,
  ChevronRight,
  Gauge,
  Sparkles,
  PlusCircle,
  Boxes,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

// ── Menu structure grouped by section ──────────────────────────────
type MenuItem = { icon: typeof LayoutDashboard; label: string; path: string };

type MenuGroup = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  color: string;
  items: MenuItem[];
};

const menuGroups: MenuGroup[] = [
  {
    id: "general",
    label: "Geral",
    icon: Gauge,
    color: "text-blue-600",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/" },
      { icon: Package, label: "Produtos", path: "/products" },
      { icon: Store, label: "Marketplaces", path: "/marketplaces" },
      { icon: Upload, label: "Exportar ML", path: "/export" },
      { icon: History, label: "Exportados", path: "/export-history" },
      { icon: ScrollText, label: "Logs", path: "/logs" },
    ],
  },
  {
    id: "ml",
    label: "Mercado Livre",
    icon: Link2,
    color: "text-yellow-600",
    items: [
      { icon: Link2, label: "Contas", path: "/ml-accounts" },
      { icon: Send, label: "Publicar", path: "/ml-publish" },
      { icon: FolderTree, label: "Categorias", path: "/ml-categories" },
    ],
  },
  {
    id: "shopee",
    label: "Shopee",
    icon: ShoppingBag,
    color: "text-orange-600",
    items: [
      { icon: ShoppingBag, label: "Contas", path: "/shopee-accounts" },
      { icon: Package, label: "Produtos", path: "/shopee-products" },
      { icon: Send, label: "Publicar", path: "/shopee-publish" },
      { icon: FileSpreadsheet, label: "Planilha", path: "/shopee-spreadsheet" },
      { icon: Sparkles,    label: "Otimizar IA",   path: "/shopee-optimizer" },
      { icon: PlusCircle, label: "Criar Anúncio", path: "/shopee-criador" },
      { icon: Boxes, label: "Anúncios Combinados", path: "/multi-product" },
    ],
  },
  {
    id: "tiktok",
    label: "TikTok Shop",
    icon: Music,
    color: "text-pink-600",
    items: [
      { icon: Music, label: "Contas", path: "/tiktok-accounts" },
      { icon: Send, label: "Publicar", path: "/tiktok-publish" },
    ],
  },
  {
    id: "amazon",
    label: "Amazon",
    icon: ShoppingCart,
    color: "text-emerald-600",
    items: [
      { icon: ShoppingCart, label: "Contas", path: "/amazon-accounts" },
      { icon: Send, label: "Publicar", path: "/amazon-publish" },
    ],
  },
  {
    id: "system",
    label: "Sistema",
    icon: Settings,
    color: "text-gray-500",
    items: [
      { icon: Settings, label: "Configurações", path: "/settings" },
      { icon: Bot, label: "Monitor Agente", path: "/agent" },
      { icon: Clock, label: "Jobs Background", path: "/background-jobs" },
    ],
  },
];

// Flat list for route matching
const allMenuItems = menuGroups.flatMap((g) => g.items);

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const OPEN_GROUPS_KEY = "sidebar-open-groups";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    // Redirect to local login page instead of Manus OAuth
    window.location.href = "/login";
    return <DashboardLayoutSkeleton />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Find which group the current route belongs to
  const activeGroup = menuGroups.find((g) =>
    g.items.some((item) => item.path === location)
  );
  const activeMenuItem = allMenuItems.find((item) => item.path === location);

  // Persist open/closed state of groups
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(OPEN_GROUPS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    // Default: open the active group + general
    const defaults: Record<string, boolean> = { general: true };
    if (activeGroup) defaults[activeGroup.id] = true;
    return defaults;
  });

  useEffect(() => {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  // Auto-open group when navigating
  useEffect(() => {
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups((prev) => ({ ...prev, [activeGroup.id]: true }));
    }
  }, [location]);

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold tracking-tight truncate text-primary">
                    BL Exporter
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 overflow-y-auto">
            {menuGroups.map((group) => {
              const isOpen = openGroups[group.id] ?? false;
              const groupHasActive = group.items.some((i) => i.path === location);

              return (
                <Collapsible
                  key={group.id}
                  open={isOpen}
                  onOpenChange={() => toggleGroup(group.id)}
                >
                  <SidebarGroup className="py-0">
                    <CollapsibleTrigger asChild>
                      <SidebarGroupLabel className="h-10 cursor-pointer hover:bg-accent/50 rounded-md mx-2 px-2 transition-colors select-none group/label">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <group.icon className={`h-4 w-4 shrink-0 ${groupHasActive ? group.color : "text-muted-foreground"}`} />
                          <span className={`text-xs font-semibold uppercase tracking-wider truncate ${groupHasActive ? "text-foreground" : "text-muted-foreground"}`}>
                            {group.label}
                          </span>
                        </div>
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                        />
                      </SidebarGroupLabel>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <SidebarGroupContent>
                        <SidebarMenu className="px-2 pb-1">
                          {group.items.map((item) => {
                            const isActive = location === item.path;
                            return (
                              <SidebarMenuItem key={item.path}>
                                <SidebarMenuButton
                                  isActive={isActive}
                                  onClick={() => setLocation(item.path)}
                                  tooltip={`${group.label} → ${item.label}`}
                                  className="h-9 transition-all font-normal pl-7"
                                >
                                  <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                                  <span className="text-sm">{item.label}</span>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              );
            })}
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">{user?.name || "-"}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">{user?.email || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground font-medium">
                {activeMenuItem?.label ?? "Menu"}
              </span>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
