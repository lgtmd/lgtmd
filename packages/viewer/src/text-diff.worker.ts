import { analyzeText, unavailableTextReview } from "./text-diff.ts";
import type { Page } from "./protocol.ts";
self.onmessage = (
  event: MessageEvent<{ id: number; before?: Page; after?: Page }>,
) => {
  const { id, before, after } = event.data;
  try {
    self.postMessage({ id, result: analyzeText(before, after) });
  } catch {
    self.postMessage({ id, result: unavailableTextReview("budget") });
  }
};
