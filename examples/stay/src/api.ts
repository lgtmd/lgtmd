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
