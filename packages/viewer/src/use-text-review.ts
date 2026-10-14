import { useEffect, useRef, useState } from "react";
import type { Page } from "./protocol.ts";
import type { TextReview } from "./text-diff.ts";
import { requestTextReview } from "./text-diff-client.ts";
export function useTextReview(
  key: string,
  enabled: boolean,
  before?: Page,
  after?: Page,
): TextReview | undefined {
  const cache = useRef<{ key: string; result: TextReview }>(undefined);
  const [completed, setCompleted] = useState<{
    key: string;
    result: TextReview;
  }>();
  useEffect(() => {
    if (cache.current?.key !== key) cache.current = undefined;
    if (!enabled || cache.current) return;
    return requestTextReview(before, after, (result) => {
      cache.current = { key, result };
      setCompleted(cache.current);
    });
  }, [key, enabled, before, after]);
  return enabled && completed?.key === key ? completed.result : undefined;
}
