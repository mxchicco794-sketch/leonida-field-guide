import { queryOptions, useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { useMemo } from "react";
import { loadDataset } from "./api";
import type { Kind } from "./types";

export const datasetQuery = queryOptions({
  queryKey: ["leonida", "dataset"],
  queryFn: loadDataset,
  staleTime: 1000 * 60 * 30, // re-sync with the source every 30 min while open
  refetchOnWindowFocus: true,
  retry: 1,
});

/** Browser-only: dataset uses Cache Storage + localStorage, so it is not loaded during SSR. */
export function useDataset() {
  const hydrated = useHydrated();
  const q = useQuery({ ...datasetQuery, enabled: hydrated });
  const kindMap = useMemo(() => {
    const m = new Map<string, Kind>();
    q.data?.categories.kinds.forEach((k) => m.set(k.key, k));
    return m;
  }, [q.data]);
  return { ...q, kindMap };
}
