"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { domainsApi, type RegisteredDomain } from "@/lib/api";
import { defaultRegisteredDomain } from "@/utils/registeredDomain";

export function useRegisteredDomains() {
  const [domains, setDomains] = useState<RegisteredDomain[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await domainsApi.listRegistered();
      setDomains(response.data ?? []);
    } catch {
      setDomains([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verifiedDomains = useMemo(() => domains.filter((domain) => domain.verified), [domains]);

  return {
    domains,
    verifiedDomains,
    defaultDomain: defaultRegisteredDomain(verifiedDomains),
    loading,
    refresh,
  };
}
