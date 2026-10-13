import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { Listing, ReplyEvent, StayRequest } from "../src/domain.ts";
import { replyScripts } from "../fixtures/scenario.ts";

export interface ProviderOptions {
  script: "A" | "B";
  failFirst: boolean;
  pause: boolean;
}

export interface ProviderCall {
  attempt: number;
  prompt: unknown;
}

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

export function replyPrompt(listing: Listing, request: StayRequest): string {
  return [
    `Listing: ${listing.title}`,
    `Location: ${listing.location}`,
    `Host: ${listing.hostName}`,
    `Guest: ${request.guestName}`,
    `Stay: ${request.checkIn} to ${request.checkOut}; ${request.guests} guests`,
    "Conversation:",
    ...request.messages.map(
      (message) => `${message.senderName}: ${message.body}`,
    ),
    "Suggest a short, helpful host reply. Do not accept the request or send a message.",
  ].join("\n");
}

// This adapter is application-owned. Only a published SDK mock is instantiated;
// it has no provider URL, API credential, or live-model fallback.
export class ReplyProvider {
  readonly calls: ProviderCall[] = [];
  paused = false;
  released = false;
  private releaseWaiter: (() => void) | undefined;
  private active = false;
  private options: ProviderOptions;

  constructor(options: ProviderOptions) {
    this.options = { ...options };
  }

  release(): void {
    this.released = true;
    this.releaseWaiter?.();
  }

  get generating(): boolean {
    return this.active;
  }

  async *generate(
    listing: Listing,
    request: StayRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ReplyEvent> {
    if (this.active) throw new Error("A reply is already being generated.");
    this.active = true;
    const attempt = this.calls.length + 1;
    const fail = this.options.failFirst && attempt === 1;
    const script = replyScripts[this.options.script];
    const provider = this;
    const model = new MockLanguageModelV4({
      provider: "stay-scripted-mock",
      modelId: `stay-reply-${this.options.script}`,
      doStream: async (options) => {
        this.calls.push({
          attempt,
          prompt: structuredClone(options.prompt),
        });
        async function* parts(): AsyncGenerator<StreamPart> {
          yield { type: "stream-start", warnings: [] };
          yield { type: "text-start", id: "reply" };
          yield { type: "text-delta", id: "reply", delta: script[0] };
          if (fail) {
            yield {
              type: "error",
              error: new Error(
                "The reply service is unavailable. Please try again.",
              ),
            };
            return;
          }
          if (provider.options.pause && !provider.released) {
            provider.paused = true;
            await new Promise<void>((resolve) => {
              const finish = () => {
                signal.removeEventListener("abort", finish);
                resolve();
              };
              provider.releaseWaiter = finish;
              signal.addEventListener("abort", finish, { once: true });
              if (provider.released || signal.aborted) finish();
            });
            provider.paused = false;
            provider.releaseWaiter = undefined;
          }
          if (signal.aborted) return;
          for (const delta of script.slice(1)) {
            yield { type: "text-delta", id: "reply", delta };
          }
          yield { type: "text-end", id: "reply" };
          yield {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 60,
                noCache: 60,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 45, text: 45, reasoning: undefined },
            },
          };
        }
        const iterator = parts();
        return {
          stream: new ReadableStream<StreamPart>({
            async pull(controller) {
              try {
                const next = await iterator.next();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
              } catch (error) {
                controller.error(error);
              }
            },
            async cancel() {
              provider.release();
              await iterator.return(undefined);
            },
          }),
        };
      },
    });
    try {
      const result = streamText({
        model,
        prompt: replyPrompt(listing, request),
        maxRetries: 0,
        abortSignal: signal,
        onError: () => {},
      });
      let finished = false;
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield { type: "text", text: part.text };
        else if (part.type === "error") {
          yield {
            type: "error",
            message: "The reply service is unavailable. Please try again.",
          };
          return;
        } else if (part.type === "finish") finished = true;
      }
      if (signal.aborted) return;
      if (!finished) throw new Error("Reply generation did not finish.");
      yield { type: "done" };
    } catch {
      if (!signal.aborted)
        yield {
          type: "error",
          message: "The reply service is unavailable. Please try again.",
        };
    } finally {
      this.active = false;
      this.paused = false;
    }
  }
}
