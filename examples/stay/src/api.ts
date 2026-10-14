import type {
  AssistantConversation,
  AssistantEvent,
} from "./assistant-domain.ts";
import type { Sessions } from "./domain.ts";
import { SESSION_KEY } from "./domain.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error ?? "Something went wrong. Please try again.",
      response.status,
    );
  return result as T;
}

export async function getSessions(): Promise<Sessions> {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    const sessions = JSON.parse(stored) as Sessions;
    if (sessions.guest?.token && sessions.host?.token) return sessions;
    throw new Error(
      "The demo session is incomplete. Open a fresh tab to start again.",
    );
  }
  const sessions = await api<Sessions>("/demo", undefined, {});
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  return sessions;
}

/** Read the app's streamed reply; only the terminal receipt is saved conversation state. */
export async function streamAssistant(
  token: string,
  message: string,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<AssistantConversation> {
  const response = await fetch("/api/assistant/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!response.ok) {
    const result = await response.json();
    throw new ApiError(
      result.error ?? "The stay finder is unavailable. Please try again.",
      response.status,
    );
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.startsWith("application/x-ndjson")
  )
    throw new Error("The reply stream is unavailable. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let conversation: AssistantConversation | undefined;
  function receive(line: string) {
    if (!line.trim()) return;
    if (conversation)
      throw new Error("The reply stream continued after completion.");
    const event = JSON.parse(line) as AssistantEvent;
    if (event.type === "text") onText(event.text);
    else if (event.type === "done") conversation = event.conversation;
    else if (event.type === "error") throw new Error(event.message);
    else throw new Error("The reply stream contained an unexpected event.");
  }
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) receive(line);
      if (chunk.done) break;
    }
    receive(buffer);
    if (!conversation)
      throw new Error("The reply ended early. Please try again.");
    return conversation;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
