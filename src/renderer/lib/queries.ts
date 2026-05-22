import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PRRef, PullRequest } from "../../shared/model/index.js";
import type { ReviewResult } from "../../shared/review.js";
import { api } from "../api.js";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface PRRow {
  pr: PullRequest;
  review: ReviewResult | null;
}

// ── Query key factories ───────────────────────────────────────────────────────

export const queryKeys = {
  prs: () => ["prs"] as const,
  diff: (ref: PRRef) => ["diff", ref] as const,
  review: (ref: PRRef, headSha: string) => ["review", ref, headSha] as const,
  settings: () => ["settings"] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function usePRList() {
  return useQuery<PRRow[]>({
    queryKey: queryKeys.prs(),
    queryFn: async () => {
      const listResult = await api.invoke("platform:listPRs");
      if (!listResult.ok) throw new Error(listResult.error.code);

      const prs: readonly PullRequest[] = listResult.value;
      const reviewResults = await Promise.all(
        prs.map((pr) => api.invoke("review:getCached", pr.ref, pr.headSha)),
      );

      return prs.map((pr, i) => ({
        pr,
        review: reviewResults[i]?.ok === true ? (reviewResults[i].value ?? null) : null,
      }));
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useDiff(ref: PRRef) {
  return useQuery({
    queryKey: queryKeys.diff(ref),
    queryFn: () => api.invoke("platform:getPRWithDiff", ref),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCachedReview(ref: PRRef, headSha: string) {
  return useQuery({
    queryKey: queryKeys.review(ref, headSha),
    queryFn: () => api.invoke("review:getCached", ref, headSha),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: headSha !== "",
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => api.invoke("settings:get"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useInvalidateReview() {
  const queryClient = useQueryClient();
  return (ref: PRRef, headSha: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.review(ref, headSha) });
}
