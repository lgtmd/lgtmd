import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Actor,
  DemoSession,
  Listing,
  Message,
  Sessions,
  StayRequest,
} from "../src/domain.ts";
import { actors, FIXED_TIME, listings } from "../fixtures/scenario.ts";
import { ReplyProvider, type ProviderOptions } from "./provider.ts";
import { AssistantError, StayAssistant } from "./assistant.ts";

interface OwnedRequest {
  value: StayRequest;
  guestId: string;
  hostId: string;
}

interface Workspace {
  id: string;
  sessions: Sessions;
  requests: Map<string, OwnedRequest>;
  provider: ReplyProvider;
  assistants: Map<string, StayAssistant>;
  nextRequest: number;
  nextActor: number;
  tokens: Set<string>;
  streams: Set<AbortController>;
}

interface SessionContext {
  workspace: Workspace;
  actor: Actor;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(response: ServerResponse, status: number, value?: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 65536)
      throw new HttpError(413, "The request body is too large.");
    chunks.push(bytes);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Send a valid JSON object.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Send a valid JSON object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `${label} cannot be empty.`);
  const result = value.trim();
  if (result.length > 2000)
    throw new HttpError(400, `${label} must be 2,000 characters or fewer.`);
  return result;
}

function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "Choose valid check-in and check-out dates.");
  return value;
}

function fixtureOptions(input: Record<string, unknown>): ProviderOptions {
  if (
    input.script !== undefined &&
    input.script !== "A" &&
    input.script !== "B"
  )
    throw new HttpError(400, "Fixture script must be A or B.");
  for (const field of ["failFirst", "pause"])
    if (input[field] !== undefined && typeof input[field] !== "boolean")
      throw new HttpError(400, `Fixture ${field} must be a boolean.`);
  return {
    script: (input.script as "A" | "B" | undefined) ?? "A",
    failFirst: (input.failFirst as boolean | undefined) ?? true,
    pause: (input.pause as boolean | undefined) ?? false,
  };
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  root: string,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(404, "Not found.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new HttpError(400, "Invalid URL path.");
  }
  if (decoded.includes("\0")) throw new HttpError(404, "Not found.");
  let target = resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + sep))
    throw new HttpError(404, "Not found.");
  try {
    if (!(await stat(target)).isFile()) throw new Error("Not a file");
  } catch {
    if (extname(decoded)) throw new HttpError(404, "Not found.");
    target = resolve(root, "index.html");
  }
  const canonical = await realpath(target).catch(() => {
    throw new HttpError(404, "Not found.");
  });
  if (!canonical.startsWith(root + sep)) throw new HttpError(404, "Not found.");
  const bytes = await readFile(canonical);
  response.writeHead(200, {
    "Content-Type": mime[extname(canonical)] ?? "application/octet-stream",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : bytes);
}

export interface ServerOptions {
  port?: number;
  fixtureKey?: string;
  staticRoot?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? 4191;
  const fixtureKey = options.fixtureKey;
  const listingData = structuredClone(listings);
  const actorData = structuredClone(actors);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Provide a port between 0 and 65535.");
  const staticRoot = options.staticRoot
    ? await realpath(options.staticRoot)
    : undefined;
  const workspaces = new Map<string, Workspace>();
  const sessions = new Map<string, SessionContext>();
  const activeStreams = new Map<AbortController, Promise<void>>();

  function register(workspace: Workspace, actor: Actor): DemoSession {
    const token = randomUUID();
    workspace.tokens.add(token);
    sessions.set(token, { workspace, actor });
    return { token, actor: structuredClone(actor) };
  }

  function createWorkspace(providerOptions: ProviderOptions): Workspace {
    const workspace: Workspace = {
      id: randomUUID(),
      sessions: {} as Sessions,
      requests: new Map(),
      provider: new ReplyProvider(providerOptions),
      assistants: new Map(),
      nextRequest: 1,
      nextActor: 1,
      tokens: new Set(),
      streams: new Set(),
    };
    workspace.sessions = {
      guest: register(workspace, actorData.guest),
      host: register(workspace, actorData.host),
    };
    workspaces.set(workspace.id, workspace);
    return workspace;
  }

  function authenticate(request: IncomingMessage): SessionContext {
    const authorization = request.headers.authorization;
    const session = authorization?.startsWith("Bearer ")
      ? sessions.get(authorization.slice(7))
      : undefined;
    if (!session)
      throw new HttpError(401, "Select a demo identity to continue.");
    return session;
  }

  function ownedRequest(
    context: SessionContext,
    requestId: string,
  ): OwnedRequest {
    const found = context.workspace.requests.get(requestId);
    if (
      !found ||
      (context.actor.id !== found.guestId && context.actor.id !== found.hostId)
    )
      throw new HttpError(404, "Stay request not found.");
    return found;
  }

  function listingFor(id: unknown): Listing {
    const listing = listingData.find((item) => item.id === id);
    if (!listing) throw new HttpError(404, "Listing not found.");
    return listing;
  }

  function message(actor: Actor, content: string, count: number): Message {
    return {
      id: `message-${String(count).padStart(3, "0")}`,
      sender: actor.role,
      senderName: actor.name,
      body: content,
      createdAt: FIXED_TIME,
    };
  }

  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const method = request.method;
      if (method === "GET" && path === "/api/health") {
        send(response, 200, { ready: true });
        return;
      }
      if (path.startsWith("/__fixtures")) {
        if (!fixtureKey || request.headers["x-stay-fixture-key"] !== fixtureKey)
          throw new HttpError(404, "Not found.");
        if (method === "POST" && path === "/__fixtures/workspaces") {
          const workspace = createWorkspace(
            fixtureOptions(await body(request)),
          );
          send(response, 201, {
            id: workspace.id,
            sessions: workspace.sessions,
          });
          return;
        }
        const fixture =
          /^\/__fixtures\/workspaces\/([^/]+)(?:\/(release|sessions))?$/.exec(
            path,
          );
        if (!fixture) throw new HttpError(404, "Not found.");
        const workspace = workspaces.get(fixture[1]);
        if (!workspace) throw new HttpError(404, "Workspace not found.");
        if (method === "GET" && !fixture[2]) {
          send(response, 200, {
            id: workspace.id,
            provider: {
              calls: workspace.provider.calls,
              paused: workspace.provider.paused,
              released: workspace.provider.released,
            },
          });
          return;
        }
        if (method === "POST" && fixture[2] === "release") {
          workspace.provider.release();
          send(response, 200, { released: true });
          return;
        }
        // Additional test actors prove ownership within a workspace as well as
        // isolation between workspaces. They are never available through the UI.
        if (method === "POST" && fixture[2] === "sessions") {
          const input = await body(request);
          if (input.role !== "guest" && input.role !== "host")
            throw new HttpError(400, "Fixture role must be guest or host.");
          const actor: Actor = {
            id: `other-${input.role}-${workspace.nextActor++}`,
            name: input.role === "guest" ? "Jordan Ellis" : "Sam Rivera",
            role: input.role,
          };
          send(response, 201, register(workspace, actor));
          return;
        }
        if (method === "DELETE" && !fixture[2]) {
          for (const controller of workspace.streams) controller.abort();
          workspace.provider.release();
          for (const token of workspace.tokens) sessions.delete(token);
          workspaces.delete(workspace.id);
          send(response, 204);
          return;
        }
        throw new HttpError(404, "Not found.");
      }
      if (method === "POST" && path === "/api/demo") {
        const workspace = createWorkspace({
          script: "A",
          failFirst: true,
          pause: false,
        });
        send(response, 201, workspace.sessions);
        return;
      }
      if (path.startsWith("/api/")) {
        const context = authenticate(request);
        const { workspace, actor } = context;
        if (method === "GET" && path === "/api/me") {
          send(response, 200, actor);
          return;
        }
        if (method === "GET" && path === "/api/listings") {
          send(response, 200, listingData);
          return;
        }
        if (
          (method === "GET" && path === "/api/assistant") ||
          (method === "POST" &&
            (path === "/api/assistant/messages" ||
              path === "/api/assistant/reset"))
        ) {
          if (actor.role !== "guest")
            throw new HttpError(403, "Only a guest can use the stay finder.");
          let assistant = workspace.assistants.get(actor.id);
          if (!assistant) {
            assistant = new StayAssistant(listingData);
            workspace.assistants.set(actor.id, assistant);
          }
          if (method === "GET") {
            send(response, 200, assistant.read());
            return;
          }
          const input = await body(request);
          if (path.endsWith("/reset")) {
            if (Object.keys(input).length)
              throw new HttpError(400, "Reset expects an empty JSON object.");
            send(response, 200, assistant.reset());
            return;
          }
          if (Object.keys(input).some((key) => key !== "message"))
            throw new HttpError(400, "Send only the message field.");
          send(response, 200, await assistant.send(input.message));
          return;
        }
        const listingMatch = /^\/api\/listings\/([^/]+)$/.exec(path);
        if (method === "GET" && listingMatch) {
          send(response, 200, listingFor(listingMatch[1]));
          return;
        }
        if (method === "GET" && path === "/api/requests") {
          send(
            response,
            200,
            [...workspace.requests.values()]
              .filter(
                (item) => item.guestId === actor.id || item.hostId === actor.id,
              )
              .map((item) => item.value),
          );
          return;
        }
        if (method === "POST" && path === "/api/requests") {
          if (actor.role !== "guest")
            throw new HttpError(403, "Only a guest can request a stay.");
          const input = await body(request);
          const listing = listingFor(input.listingId);
          const checkIn = date(input.checkIn);
          const checkOut = date(input.checkOut);
          if (checkOut <= checkIn)
            throw new HttpError(400, "Check-out must be after check-in.");
          if (
            typeof input.guests !== "number" ||
            !Number.isInteger(input.guests) ||
            input.guests < 1 ||
            input.guests > listing.capacity
          )
            throw new HttpError(
              400,
              `Choose between 1 and ${listing.capacity} guests.`,
            );
          const content = text(input.message, "Message");
          const value: StayRequest = {
            id: `request-${String(workspace.nextRequest++).padStart(3, "0")}`,
            listingId: listing.id,
            guestName: actor.name,
            checkIn,
            checkOut,
            guests: input.guests,
            status: "pending",
            createdAt: FIXED_TIME,
            messages: [message(actor, content, 1)],
          };
          workspace.requests.set(value.id, {
            value,
            guestId: actor.id,
            hostId: actorData.host.id,
          });
          send(response, 201, value);
          return;
        }
        const match =
          /^\/api\/requests\/([^/]+)(?:\/(messages|accept|reply))?$/.exec(path);
        if (match) {
          const owned = ownedRequest(context, match[1]);
          const stay = owned.value;
          if (method === "GET" && !match[2]) {
            send(response, 200, stay);
            return;
          }
          if (method === "POST" && match[2] === "messages") {
            const input = await body(request);
            stay.messages.push(
              message(
                actor,
                text(input.body, "Message"),
                stay.messages.length + 1,
              ),
            );
            send(response, 200, stay);
            return;
          }
          if (
            method === "POST" &&
            (match[2] === "accept" || match[2] === "reply")
          ) {
            if (actor.id !== owned.hostId)
              throw new HttpError(403, "Only the listing host can do that.");
            if (match[2] === "accept") {
              stay.status = "accepted";
              send(response, 200, stay);
              return;
            }
            if (workspace.provider.generating)
              throw new HttpError(409, "A reply is already being generated.");
            const controller = new AbortController();
            let streamStopped: () => void = () => {};
            activeStreams.set(
              controller,
              new Promise<void>((resolve) => {
                streamStopped = resolve;
              }),
            );
            workspace.streams.add(controller);
            const abort = () => {
              if (!response.writableEnded) controller.abort();
            };
            response.on("close", abort);
            response.writeHead(200, {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            try {
              for await (const event of workspace.provider.generate(
                listingFor(stay.listingId),
                structuredClone(stay),
                controller.signal,
              )) {
                if (response.destroyed) break;
                response.write(JSON.stringify(event) + "\n");
              }
              response.end();
            } finally {
              response.off("close", abort);
              activeStreams.delete(controller);
              workspace.streams.delete(controller);
              streamStopped();
            }
            return;
          }
        }
        throw new HttpError(404, "Not found.");
      }
      if (staticRoot) {
        await serveStatic(request, response, path, staticRoot);
        return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (response.headersSent) response.destroy();
      else if (error instanceof HttpError || error instanceof AssistantError)
        send(response, error.status, { error: error.message });
      else
        send(response, 500, {
          error: "The local service could not complete the request.",
        });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local server address.");
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      closing ??= (async () => {
        const stoppedStreams = [...activeStreams.values()];
        for (const controller of activeStreams.keys()) controller.abort();
        for (const workspace of workspaces.values())
          workspace.provider.release();
        const stoppedListener = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        // Shutdown owns these loopback connections. Stop listening first, then
        // close streams and keep-alive sockets without waiting for their peers.
        server.closeAllConnections();
        await Promise.all([stoppedListener, ...stoppedStreams]);
        sessions.clear();
        workspaces.clear();
      })();
      return closing;
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const index = process.argv.indexOf("--port");
  const server = await startServer({
    port: index < 0 ? 4191 : Number(process.argv[index + 1]),
  });
  process.stdout.write(`Stay API listening at ${server.url}\n`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
}
