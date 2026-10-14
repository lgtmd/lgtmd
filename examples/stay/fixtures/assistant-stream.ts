import { MockLanguageModelV4 } from "ai/test";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type Outcome = "success" | "error" | "truncated";

/** A project-owned stream gate for checking partial replies without timing sleeps. */
export function assistantStreamGate() {
  let finish!: (outcome: Outcome) => void;
  const released = new Promise<Outcome>((resolve) => {
    finish = resolve;
  });
  let aborted!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  return {
    finish,
    cancelled,
    model(response: string) {
      return new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          let stop = () => {};
          return {
            stream: new ReadableStream<StreamPart>({
              start(controller) {
                let closed = false;
                const cleanup = () => {
                  closed = true;
                  abortSignal?.removeEventListener("abort", abort);
                };
                const abort = () => {
                  if (closed) return;
                  cleanup();
                  controller.close();
                  aborted();
                };
                stop = () => {
                  cleanup();
                  aborted();
                };
                abortSignal?.addEventListener("abort", abort, { once: true });
                if (abortSignal?.aborted) {
                  abort();
                  return;
                }
                controller.enqueue({ type: "stream-start", warnings: [] });
                controller.enqueue({ type: "text-start", id: "reply" });
                controller.enqueue({
                  type: "text-delta",
                  id: "reply",
                  delta: response.slice(0, 32),
                });
                void released.then((outcome) => {
                  if (closed) return;
                  cleanup();
                  if (outcome === "error") {
                    controller.enqueue({
                      type: "error",
                      error: new Error("Declared stream failure"),
                    });
                  } else if (outcome === "success") {
                    controller.enqueue({
                      type: "text-delta",
                      id: "reply",
                      delta: response.slice(32),
                    });
                    controller.enqueue({ type: "text-end", id: "reply" });
                    controller.enqueue({
                      type: "finish",
                      finishReason: { unified: "stop", raw: undefined },
                      usage: {
                        inputTokens: {
                          total: 0,
                          noCache: 0,
                          cacheRead: undefined,
                          cacheWrite: undefined,
                        },
                        outputTokens: {
                          total: 0,
                          text: 0,
                          reasoning: undefined,
                        },
                      },
                    });
                  }
                  controller.close();
                });
              },
              cancel() {
                stop();
              },
            }),
          };
        },
      });
    },
  };
}
