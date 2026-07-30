"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  Rocket,
  Globe,
  Activity,
  Settings,
  CreditCard,
  LogOut,
  Loader2,
  Moon,
  Sun,
  SunMoon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Server,
  Mail,
  Clock,
  DatabaseBackup,
  Building2,
  ChevronsUpDown,
  Check,
  Boxes,
  Search,
  Command,
  HelpCircle,
  GitBranch,
  Container,
  ListTree,
  UserRound,
} from "lucide-react";
import { authClient, signOut } from "@/lib/auth-client";
import { useTheme } from "@/components/theme-provider";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { Logo } from "@/components/logo";
import { useAuth } from "@/context/AuthContext";
import { usePlatform } from "@/context/PlatformContext";
import { useCloud } from "@/context/CloudContext";
import { DismissiblePopover } from "@/components/ui/Popover";
import { setActiveOrganizationId } from "@/lib/api/client";
import { projectsApi } from "@/lib/api";
import {
  getSidebarNavCountsRevision,
  subscribeSidebarNavCounts,
} from "@/lib/sidebar-nav-counts";

/**
 * Org list / member shapes from Better Auth's organization plugin.
 * Mirrors the inline types used in account-switcher.tsx and TeamTab.tsx.
 */
interface SidebarOrg {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
}

interface SidebarMember {
  id: string;
  userId: string;
  role: string;
}

/**
 * Module-level singleton — Better Auth's React client wraps the
 * organization plugin in a Proxy whose property accesses return a fresh
 * reference, so capturing it inside the component body and using it as a
 * useEffect dep creates an infinite render loop. See TeamTab for the
 * full explanation.
 */
const sidebarOrgClient = (
  authClient as unknown as {
    organization: {
      list: () => Promise<{ data?: SidebarOrg[] }>;
      setActive: (opts: { organizationId: string }) => Promise<{ error?: { message?: string } }>;
      getFullOrganization: (opts?: {
        organizationId: string;
      }) => Promise<{ data?: { id: string; members?: SidebarMember[] } | null }>;
    };
  }
).organization;

interface NavItem {
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Nested items shown indented beneath this one (e.g. Apps under Projects). */
  children?: NavItem[];
}

interface NavSection {
  section?: string; // i18n key under t.dashboard.nav.sections
  items: NavItem[];
}

const MAIN_ITEMS: NavItem[] = [
  { key: "home", href: "/", icon: LayoutDashboard },
  { key: "projects", href: "/projects", icon: FolderKanban },
  { key: "apps", href: "/apps", icon: Building2 },
  { key: "deployments", href: "/deployments", icon: Rocket },
];

/** Build nav sections dynamically */
function getNavSections(isSaaS: boolean, selfHosted: boolean): NavSection[] {
  const settingsItems: NavItem[] = [
    { key: "backups", href: "/backups", icon: DatabaseBackup },
    { key: "settings", href: "/settings", icon: Settings },
  ];
  if (isSaaS) {
    settingsItems.push({ key: "billing", href: "/billing", icon: CreditCard });
  }

  const infraItems: NavItem[] = [];
  if (selfHosted) {
    infraItems.push({ key: "servers", href: "/servers", icon: Server });
    infraItems.push({ key: "kubernetes", href: "/kubernetes", icon: Boxes });
    infraItems.push({ key: "domains", href: "/domains", icon: Globe });
    infraItems.push({ key: "emails", href: "/emails", icon: Mail });
    infraItems.push({ key: "jobs", href: "/jobs", icon: Clock });
  }
  // infraItems.push(
  //   { key: "monitoring", href: "/monitoring", icon: Activity },
  //   { key: "domains",    href: "/domains",    icon: Globe },
  // );

  return [
    { section: "main", items: MAIN_ITEMS },
    { section: "settings", items: settingsItems },
    { section: "infrastructure", items: infraItems },
  ].filter((s) => s.items.length > 0);
}

export function Sidebar() {
  const { user } = useAuth();
  const { selfHosted, deployMode, authMode, machineName } = usePlatform();
  const { connected: cloudConnected, cloudUser } = useCloud();
  const isDesktop = deployMode === "desktop";

  // The primary identity in the sidebar header is ALWAYS the local Better
  // Auth user (the "who am I on this self-hosted instance" - the operator-
  // of-record whose org, team, audit log, and permissions every other
  // surface in the dashboard is scoped to). A cloud connection is a
  // CREDENTIAL the local user HOLDS (used to mint namespace tokens, proxy
  // GitHub App, etc.) - not an identity replacement.
  //
  // The external SaaS profile (cloudUser.name / cloudUser.email) belongs in
  // Settings -> CloudConnection where it lives as a "Linked to Openship
  // Cloud as <email>" card. We surface it here only as a small secondary
  // hint line under the local identity when a cloud session is active, so
  // the operator can see WHICH external account is linked without ever
  // having the local user's name swapped out from under them.
  //
  // Fallback for the zero-auth desktop case (Electron build where no
  // Better Auth user exists yet, e.g. fresh install before onboarding):
  // fall back to machineName, NEVER to the cloud profile.
  const displayName =
    user?.name || user?.email?.split("@")[0] || (isDesktop ? machineName || "Local User" : "");
  const displayEmail = user?.email || (isDesktop ? "Desktop" : "");
  const cloudBadge = cloudConnected ? cloudUser : null;
  const displayInitial = displayName?.[0] ?? displayEmail?.[0] ?? "?";
  const isSaaS = !selfHosted || cloudConnected;
  const navSections = getNavSections(isSaaS, selfHosted);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { resolvedTheme, toggle } = useTheme();
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [navCounts, setNavCounts] = useState<{ projects: number; apps: number } | null>(null);
  const [navCountsRevision, setNavCountsRevision] = useState(getSidebarNavCountsRevision);
  const countFor = (key: string): number | null => {
    if (!navCounts) return null;
    if (key === "projects") return navCounts.projects;
    if (key === "apps") return navCounts.apps;
    return null;
  };

  useEffect(() => subscribeSidebarNavCounts(() => {
    setNavCountsRevision(getSidebarNavCountsRevision());
  }), []);

  // Org switcher state. Lazy-loaded — `list()` and the active org fetch
  // only fire after the first popover open so the sidebar doesn't pay
  // for the round-trip on every page load. The role chip for the active
  // org is fetched alongside.
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [orgs, setOrgs] = useState<SidebarOrg[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [activeOrgRole, setActiveOrgRole] = useState<string | null>(null);
  const [orgRoles, setOrgRoles] = useState<Record<string, string>>({});
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);

  // Fetch on mount so the trigger shows the current org name without
  // waiting for the user to click. Cheap (one /list call) and mirrors
  // the AccountSwitcher pattern.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listRes, activeRes] = await Promise.all([
          sidebarOrgClient.list(),
          sidebarOrgClient.getFullOrganization().catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        const list = listRes.data ?? [];
        setOrgs(list);
        const aid = (activeRes.data as { id: string } | null)?.id ?? null;
        setActiveOrgId(aid);
        setActiveOrganizationId(aid);
        setOrgsLoaded(true);
        // Per-workspace role for EVERY row (not just the active one) so you can
        // tell which workspaces you own. One getFullOrganization per org;
        // failures just leave that row's chip off.
        try {
          const entries = await Promise.all(
            list.map(async (o) => {
              try {
                const full = await sidebarOrgClient.getFullOrganization({ organizationId: o.id });
                const me = full.data?.members?.find((m) => m.userId === user?.id);
                return [o.id, me?.role ?? null] as const;
              } catch {
                return [o.id, null] as const;
              }
            }),
          );
          if (cancelled) return;
          const map = Object.fromEntries(entries.filter(([, r]) => r)) as Record<string, string>;
          setOrgRoles(map);
          if (aid) setActiveOrgRole(map[aid] ?? null);
        } catch {
          /* role chips optional */
        }
      } catch {
        /* org switcher hidden when fetch fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Nav counts — Projects & Apps only, from the same `projects/home` payload
  // both pages load. Apps are projects with `isApp` (catalog installs); the
  // Projects nav counts the REST (real projects), exactly mirroring what each
  // page renders — apps live only under Apps, never double-counted.
  //
  // Gated on `orgsLoaded`: the count fetch must run under the resolved active
  // org (the org effect above sets `setActiveOrganizationId` a round-trip
  // later). Firing on mount races that and can pull an extra project from the
  // wrong scope — the "2 real projects showed 3" bug. Re-runs on org switch.
  useEffect(() => {
    if (!orgsLoaded) return;
    let cancelled = false;
    projectsApi
      .getHome()
      .then((res) => {
        if (cancelled || !res?.success || !Array.isArray(res.projects)) return;
        // Distinct by id — the payload merges local + cloud, which can list the
        // same project twice; a dupe must not inflate the tally.
        const seen = new Set<string>();
        let projects = 0;
        let apps = 0;
        for (const p of res.projects) {
          const id = p?.id;
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          if (p?.isApp) apps += 1;
          else projects += 1;
        }
        setNavCounts({ projects, apps });
      })
      .catch(() => {
        /* counts are optional chrome — silent on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [orgsLoaded, activeOrgId, navCountsRevision]);

  async function handleOrgSwitch(orgId: string) {
    if (orgId === activeOrgId) {
      setOrgsOpen(false);
      return;
    }
    setSwitchingOrgId(orgId);
    try {
      const res = await sidebarOrgClient.setActive({ organizationId: orgId });
      if (res.error) {
        setSwitchingOrgId(null);
        return;
      }
      setActiveOrganizationId(orgId);
      // Reload so every list endpoint re-fetches under the new scope.
      window.location.reload();
    } catch {
      setSwitchingOrgId(null);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      if (isDesktop && (window as any).desktop?.reset) {
        // Desktop: reset config and return to Electron onboarding
        await (window as any).desktop.reset();
        return;
      }
      await signOut();
      router.push("/login");
    } catch {
      setLoggingOut(false);
    }
  }

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0] ?? null;
  const showOrgSwitcher = orgsLoaded && !!activeOrg;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const label = (key: string) => (t.dashboard.nav as unknown as Record<string, string>)[key] ?? key;

  const sectionLabel = (key: string) =>
    (t.dashboard.nav.sections as unknown as Record<string, string>)[key] ?? key;

  const workspaceOwner = displayName.trim().split(/\s+/)[0] || "Operator";
  const workspaceLabel = `${workspaceOwner}'s workspace`;
  const operatorSections = [
    {
      label: "Manage",
      items: [
        { label: label("projects"), href: "/projects", icon: FolderKanban, count: countFor("projects") },
        { label: label("apps"), href: "/apps", icon: Boxes, count: countFor("apps") },
        { label: label("deployments"), href: "/deployments", icon: Rocket, count: null },
      ],
    },
    {
      label: "Infrastructure",
      items: [
        { label: label("kubernetes"), href: "/kubernetes", icon: Boxes, count: null },
        { label: label("servers"), href: "/servers", icon: Server, count: null },
        { label: label("domains"), href: "/domains", icon: Globe, count: null },
        { label: label("backups"), href: "/backups", icon: DatabaseBackup, count: null },
      ],
    },
    {
      label: "Configure",
      items: [
        { label: "Sources", href: "/settings?section=sources", icon: GitBranch, count: null },
        { label: "Registries", href: "/settings?section=registries", icon: Container, count: null },
        { label: "Variables", href: "/projects?view=variables", icon: ListTree, count: null },
        { label: label("settings"), href: "/settings", icon: Settings, count: null },
      ],
    },
  ];

  return (
    <aside
      className={`operator-sidebar flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ${
        collapsed ? "operator-sidebar--collapsed w-[72px]" : "w-[260px]"
      }`}
    >
      <div className="operator-sidebar__header">
        <div className="operator-sidebar__brand-row">
          <div className="operator-sidebar__brand">
            <Logo size={28} />
            {!collapsed && <span>{t.brand}</span>}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? t.dashboard.sidebar.expand : t.dashboard.sidebar.collapse}
            title={collapsed ? t.dashboard.sidebar.expand : t.dashboard.sidebar.collapse}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>

        {!collapsed && (
          <>
            <button
              type="button"
              className="operator-sidebar__workspace"
              onClick={() => showOrgSwitcher && setOrgsOpen((value) => !value)}
              disabled={!showOrgSwitcher}
              aria-label={`Switch workspace from ${workspaceLabel}`}
              aria-expanded={showOrgSwitcher ? orgsOpen : undefined}
            >
              <strong>{workspaceLabel}</strong>
              {showOrgSwitcher && <ChevronsUpDown />}
            </button>
            <span className="operator-sidebar__mode">
              {selfHosted && !cloudConnected ? "Self-hosted" : "Cloud"}
            </span>
            <button
              type="button"
              className="operator-sidebar__find"
              onClick={() => document.getElementById("operator-global-search")?.focus()}
            >
              <Search />
              <span>Find</span>
              <kbd><Command />K</kbd>
            </button>
          </>
        )}
      </div>

      <nav className="operator-sidebar__nav">
        {operatorSections.map((section) => (
          <section key={section.label}>
            {!collapsed && <p>{section.label}</p>}
            <div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const [cleanHref, query = ""] = item.href.split("?");
                const targetParams = new URLSearchParams(query);
                const targetSection = targetParams.get("section");
                const targetView = targetParams.get("view");
                const pathMatches =
                  pathname === cleanHref || (!query && pathname.startsWith(`${cleanHref}/`));
                const active =
                  pathMatches &&
                  (targetSection
                    ? searchParams.get("section") === targetSection
                    : targetView
                      ? searchParams.get("view") === targetView
                      : !searchParams.get("section") && !searchParams.get("view"));
                return (
                  <Link
                    key={`${section.label}-${item.label}`}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon strokeWidth={1.7} />
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && item.count != null && item.count > 0 && (
                      <small>{item.count}</small>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="operator-sidebar__footer">
        <DismissiblePopover open={orgsOpen} onOpenChange={setOrgsOpen} className="relative">
          <button
            type="button"
            className="operator-sidebar__operator"
            onClick={() => setOrgsOpen((value) => !value)}
            aria-haspopup="dialog"
            aria-expanded={orgsOpen}
            title={collapsed ? "Operator" : undefined}
          >
            <span className="operator-sidebar__avatar">
              {displayInitial || <UserRound />}
            </span>
            {!collapsed && (
              <>
                <span className="operator-sidebar__identity">
                  <strong>{displayName || "Operator"}</strong>
                  <small>{displayEmail || activeOrgRole || "Local account"}</small>
                </span>
                <ChevronsUpDown />
              </>
            )}
          </button>

          {showOrgSwitcher && orgsOpen && (
            <div
              className="operator-sidebar__popover"
              role="dialog"
              aria-label="Switch workspace"
            >
              <p>Switch workspace</p>
              {orgs.map((org) => {
                const current = org.id === activeOrgId;
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => handleOrgSwitch(org.id)}
                    disabled={!!switchingOrgId}
                  >
                    <span>{org.name?.[0] ?? "O"}</span>
                    <strong>{org.name}</strong>
                    {current && <Check />}
                  </button>
                );
              })}
            </div>
          )}
        </DismissiblePopover>

        <a
          className="operator-sidebar__utility"
          href="https://github.com/mustafamagdy/openship"
          target="_blank"
          rel="noreferrer"
          title={collapsed ? "Help" : undefined}
        >
          <HelpCircle />
          {!collapsed && <span>Help</span>}
        </a>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="operator-sidebar__utility"
          title={collapsed ? (isDesktop ? t.chrome.sidebar.backToSetup : t.dashboard.user.logout) : undefined}
        >
          {loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
          {!collapsed && (
            <span>{isDesktop ? t.chrome.sidebar.backToSetup : "Sign out"}</span>
          )}
        </button>
      </div>
    </aside>
  );
}
