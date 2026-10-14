import type { Page } from "./protocol.ts";
import {
  TEXT_LIMITS,
  withinTextBudget,
  unavailableTextReview,
  type TextReview,
} from "./text-diff.ts";
let nextRequest = 0;
export function requestTextReview(
  before: Page | undefined,
  after: Page | undefined,
  receive: (result: TextReview) => void,
  createWorker: () => Worker = () =>
    new Worker(new URL("./text-diff.worker.ts", import.meta.url), {
      type: "module",
    }),
): () => void {
  if (!withinTextBudget(before) || !withinTextBudget(after)) {
    receive(unavailableTextReview("budget"));
    return () => {};
  }
  const id = ++nextRequest;
  let active = true;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    active = false;
    clearTimeout(timer);
    worker?.terminate();
  };
  const finish = (result: TextReview) => {
    if (active) {
      cancel();
      receive(result);
    }
  };
  try {
    worker = createWorker();
    worker.onmessage = (event) => {
      if (event.data.id === id) finish(event.data.result);
    };
    worker.onerror = () => finish(unavailableTextReview("budget"));
    worker.onmessageerror = () => finish(unavailableTextReview("budget"));
    timer = setTimeout(
      () => finish(unavailableTextReview("budget")),
      TEXT_LIMITS.timeout,
    );
    worker.postMessage({ id, before, after });
  } catch {
    finish(unavailableTextReview("budget"));
  }
  return cancel;
}
