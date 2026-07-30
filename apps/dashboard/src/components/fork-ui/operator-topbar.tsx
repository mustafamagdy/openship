"use client";

import { Bell, Command, Search } from "lucide-react";
import { usePathname } from "next/navigation";

const ROUTE_LABELS: Array<[string, string]> = [
  ["/kubernetes", "Kubernetes"],
  ["/projects", "Projects"],
  ["/apps", "Apps"],
  ["/deployments", "Deployments"],
  ["/servers", "Servers"],
  ["/domains", "Domains"],
  ["/backups", "Backups"],
  ["/settings", "Settings"],
];

function currentLabel(pathname: string): string {
  return ROUTE_LABELS.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ??
    "Overview";
}

export function OperatorTopbar() {
  const pathname = usePathname();

  return (
    <header className="operator-topbar">
      <div className="operator-topbar__scope">
        <span>Infrastructure</span>
        <span aria-hidden="true">/</span>
        <strong>{currentLabel(pathname)}</strong>
      </div>
      <label className="operator-topbar__search">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label="Search OpenShip"
          placeholder="Search projects, workloads, servers…"
        />
        <kbd>
          <Command aria-hidden="true" /> K
        </kbd>
      </label>
      <button type="button" className="operator-topbar__icon" aria-label="Notifications">
        <Bell aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
    </header>
  );
}
