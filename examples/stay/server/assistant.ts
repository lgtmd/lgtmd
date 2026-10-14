import { streamText } from "ai";
import { setTimeout as delay } from "node:timers/promises";
import { MockLanguageModelV4 } from "ai/test";
import type {
  AssistantConversation,
  AssistantEvent,
} from "../src/assistant-domain.ts";
import type { Listing } from "../src/domain.ts";
import {
  defaultFilters,
  filterListings,
  validateFilters,
  type StayFilters,
} from "../src/filters.ts";

const amenityAliases: Record<string, RegExp> = {
  "Full kitchen": /\b(?:full\s+)?kitchen\b/gi,
  "Wi-Fi": /\bwi[\s-]?fi\b/gi,
  "Free parking": /\b(?:free\s+)?parking\b/gi,
  "Woodland trails": /\b(?:woodland\s+)?trails?\b/gi,
  Workspace: /\b(?:workspace|work\s+space|desk)\b/gi,
  "Private courtyard": /\b(?:private\s+)?courtyard\b/gi,
  "Ocean view": /\b(?:(?:ocean|sea)\s+view|by the (?:ocean|sea))\b/gi,
  "Private deck": /\b(?:private\s+)?deck\b/gi,
};

// A deliberately small parser makes the supported demo behavior inspectable.
// It does not claim to interpret arbitrary language or infer live availability.
function parsePreferences(
  previous: StayFilters,
  message: string,
  listings: readonly Listing[],
): { preferences: StayFilters; recognized: boolean } {
  let recognized =
    /\b(?:start over|reset(?: my)? search|clear(?: all)? filters)\b/i.test(
      message,
    );
  const next = recognized ? defaultFilters() : structuredClone(previous);
  const budget = [
    ...message.matchAll(
      /\b(?:under|up to|at most|(?:raise|increase|lower|change|set)(?: my)? budget to|budget(?: of| is|:)?)[\s$]*([+-]?\$?(?:\d[\d.,]*(?:e[+-]?\d+)?|\.\d+|infinity|nan))/gi,
    ),
  ]
    .filter(
      (match) =>
        !/^\s*(?:guests?|people|adults?|nights?|days?)\b/i.test(
          message.slice(match.index! + match[0].length),
        ),
    )
    .at(-1);
  if (budget) {
    next.maxPrice = nightlyPrice(budget[1]);
    recognized = true;
  }
  const minimum = [
    ...message.matchAll(
      /\b(?:at least(?=\s*[+-]?\$)|minimum (?:price|budget|nightly rate)(?: of| is|:)?)[\s$]*([+-]?\$?(?:\d[\d.,]*(?:e[+-]?\d+)?|\.\d+|infinity|nan))(?![\w.,])(?!\s*(?:guests?|people|adults?|nights?|days?)\b)/gi,
    ),
  ].at(-1);
  if (minimum) {
    next.minPrice = nightlyPrice(minimum[1]);
    recognized = true;
  }
  if (
    /\b(?:any budget|no (?:price|budget) limit|remove (?:the )?budget)\b/i.test(
      message,
    )
  ) {
    next.minPrice = null;
    next.maxPrice = null;
    recognized = true;
  }
  const guests = [
    ...message.matchAll(
      /(?<![\w.+-])([+-]?\d+(?:\.\d+)?)\s+(?:guests?|people|adults?)\b/gi,
    ),
  ].at(-1);
  if (guests) {
    next.guests = Number(guests[1]);
    recognized = true;
  }
  if (
    /\b(?:any (?:number of )?guests|remove (?:the )?guest limit)\b/i.test(
      message,
    )
  ) {
    next.guests = 1;
    recognized = true;
  }
  if (/\b(?:anywhere|any location|remove (?:the )?location)\b/i.test(message)) {
    next.query = "";
    recognized = true;
  } else {
    const locations = [
      ...new Set(
        listings.flatMap((listing) => [
          listing.title,
          ...listing.location.split(",").map((part) => part.trim()),
        ]),
      ),
    ].sort((a, b) => b.length - a.length);
    const knownLocation = locations.find((location) =>
      new RegExp(
        `\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(message),
    );
    const requestedLocation =
      /\b(?:in|near|around)\s+(.+?)(?=\s+(?:for|under|up to|with|and|budget)\b|[.!?]|$)/i
        .exec(message)?.[1]
        .trim();
    if (knownLocation || requestedLocation) {
      next.query = knownLocation ?? requestedLocation!;
      recognized = true;
    }
  }
  if (
    /\b(?:any amenities|no amenities needed|clear amenities)\b/i.test(message)
  ) {
    next.amenities = [];
    recognized = true;
  }
  const available = new Set(listings.flatMap((listing) => listing.amenities));
  for (const [amenity, pattern] of Object.entries(amenityAliases)) {
    if (!available.has(amenity)) continue;
    for (const match of message.matchAll(pattern)) {
      recognized = true;
      const prefix = message.slice(Math.max(0, match.index! - 35), match.index);
      const suffix = message.slice(
        match.index! + match[0].length,
        match.index! + match[0].length + 25,
      );
      const remove =
        /\b(?:without|no|not(?: with)?|remove|(?:do not|don't) (?:need|want))(?:\s+(?:a|an|the|any))?\s*$/i.test(
          prefix,
        ) || /^\s+(?:is\s+)?not (?:needed|required|necessary)\b/i.test(suffix);
      next.amenities = next.amenities.filter((item) => item !== amenity);
      if (!remove) next.amenities.push(amenity);
    }
  }
  next.amenities.sort();
  return { preferences: next, recognized };
}

function nightlyPrice(token: string): number {
  const value = token.replace("$", "").replace(/[.,]$/, "");
  const number = Number(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(number))
    throw new AssistantError(
      400,
      "Use a non-negative nightly budget with up to two decimal places.",
    );
  return number;
}

export function updatePreferences(
  previous: StayFilters,
  message: string,
  listings: readonly Listing[],
): StayFilters {
  return parsePreferences(previous, message, listings).preferences;
}

function description(preferences: StayFilters): string {
  const parts = [
    `for ${preferences.guests} ${preferences.guests === 1 ? "guest" : "guests"}`,
  ];
  if (preferences.query) parts.push(`in ${preferences.query}`);
  if (preferences.minPrice !== null)
    parts.push(`from $${preferences.minPrice} per night`);
  if (preferences.maxPrice !== null)
    parts.push(`up to $${preferences.maxPrice} per night`);
  if (preferences.amenities.length)
    parts.push(`with ${preferences.amenities.join(" and ")}`);
  return parts.join(", ");
}

function reply(
  preferences: StayFilters,
  matches: Listing[],
  recognized: boolean,
): string {
  if (!recognized)
    return "I can match location, nightly budget, guest count, and listed amenities in this demo collection. Try '3 guests under $200 with a kitchen'. Other preferences are not interpreted by this scripted assistant.";
  if (!matches.length)
    return `No stays in this demo collection match ${description(preferences)}. Try a higher budget, fewer guests, another location, or removing an amenity.`;
  return `I found ${matches.length} ${matches.length === 1 ? "stay" : "stays"} in this demo collection ${description(preferences)}. ${matches.map((listing) => `${listing.title} is $${listing.nightlyRate} per night and sleeps ${listing.capacity}.`).join(" ")}`;
}

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
export type AssistantModelFactory = (response: string) => MockLanguageModelV4;

function scriptedModel(response: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "stay-scripted-mock",
    modelId: "stay-finder",
    doStream: async ({ abortSignal }) => {
      const parts: StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "reply" },
        ...response.match(/\S+\s*/g)!.map((delta) => ({
          type: "text-delta" as const,
          id: "reply",
          delta,
        })),
        { type: "text-end", id: "reply" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
          },
        },
      ];
      let index = 0;
      let cancelled = false;
      return {
        stream: new ReadableStream<StreamPart>({
          async pull(controller) {
            try {
              const part = parts[index++];
              // Pace the local mock so interactive guests can see each text chunk.
              if (part?.type === "text-delta")
                await delay(25, undefined, { signal: abortSignal });
              if (cancelled) return;
              if (part) controller.enqueue(part);
              else controller.close();
            } catch (error) {
              if (!cancelled) controller.error(error);
            }
          },
          cancel() {
            cancelled = true;
          },
        }),
      };
    },
  });
}

export class AssistantError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Conversations belong to the app server, not the documentation harness. The
// only model factory supplied by the HTTP application is the local SDK mock.
export class StayAssistant {
  private conversation: AssistantConversation = {
    messages: [],
    preferences: defaultFilters(),
  };
  private listings: Listing[];
  private modelFactory: AssistantModelFactory;
  private active = false;

  constructor(
    listings: readonly Listing[],
    modelFactory: AssistantModelFactory = scriptedModel,
  ) {
    this.listings = structuredClone([...listings]);
    this.modelFactory = modelFactory;
  }

  read(): AssistantConversation {
    return structuredClone(this.conversation);
  }

  reset(): AssistantConversation {
    if (this.active)
      throw new AssistantError(409, "Wait for the current search to finish.");
    this.conversation = { messages: [], preferences: defaultFilters() };
    return this.read();
  }

  async send(input: unknown): Promise<AssistantConversation> {
    for await (const event of this.stream(
      input,
      new AbortController().signal,
    )) {
      if (event.type === "done") return event.conversation;
    }
    throw new AssistantError(
      503,
      "The local assistant could not finish. Please try again.",
    );
  }

  async *stream(
    input: unknown,
    signal: AbortSignal,
  ): AsyncGenerator<AssistantEvent> {
    if (typeof input !== "string" || !input.trim())
      throw new AssistantError(400, "Message cannot be empty.");
    const message = input.trim();
    if (message.length > 1000)
      throw new AssistantError(
        400,
        "Message must be 1,000 characters or fewer.",
      );
    if (this.active)
      throw new AssistantError(409, "Wait for the current search to finish.");
    const { preferences, recognized } = parsePreferences(
      this.conversation.preferences,
      message,
      this.listings,
    );
    const invalid = validateFilters(preferences);
    if (invalid) throw new AssistantError(400, invalid);
    const matches = recognized
      ? filterListings(this.listings, preferences)
      : [];
    const response = reply(preferences, matches, recognized);
    this.active = true;
    try {
      const generated = streamText({
        model: this.modelFactory(response),
        maxRetries: 0,
        abortSignal: signal,
        onError: () => {},
        prompt: [
          "This is a deterministic accommodation search demo, not a live assistant.",
          "Only return the scripted reply derived from the supplied collection.",
          `Previous conversation: ${JSON.stringify(this.conversation.messages)}`,
          `Guest: ${message}`,
          `Recognized preferences: ${JSON.stringify(preferences)}`,
          `Matching listings: ${JSON.stringify(matches.map(({ id, title, location, nightlyRate, capacity, amenities }) => ({ id, title, location, nightlyRate, capacity, amenities })))}`,
          `Scripted reply: ${response}`,
        ].join("\n"),
      });
      let text = "";
      let finished = false;
      for await (const part of generated.fullStream) {
        if (signal.aborted) return;
        if (part.type === "text-delta") {
          text += part.text;
          yield { type: "text", text: part.text };
        } else if (part.type === "error") {
          throw part.error;
        } else if (part.type === "finish") {
          finished = part.finishReason === "stop";
        }
      }
      if (signal.aborted) return;
      if (text !== response || !finished)
        throw new Error(
          "The scripted assistant did not complete its declared reply.",
        );
      const count = this.conversation.messages.length;
      this.conversation = {
        preferences,
        messages: [
          ...this.conversation.messages,
          {
            id: `assistant-message-${String(count + 1).padStart(3, "0")}`,
            role: "user",
            text: message,
          },
          {
            id: `assistant-message-${String(count + 2).padStart(3, "0")}`,
            role: "assistant",
            text,
            ...(recognized
              ? { listingIds: matches.map((listing) => listing.id) }
              : {}),
          },
        ],
      };
      yield { type: "done", conversation: this.read() };
    } catch {
      if (signal.aborted) return;
      throw new AssistantError(
        503,
        "The local assistant could not finish. Please try again.",
      );
    } finally {
      this.active = false;
    }
  }
}
