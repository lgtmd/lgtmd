import { Doc } from "./authoring.js";
import { singleLine, validId } from "./model.js";
import type { FrozenDocument, Page } from "./model.js";

export interface Prepared<T> {
  readonly context: T;
  /** Omit cleanup when preparation acquires no resources. */
  readonly cleanup?: () => void | Promise<void>;
}

const definition = Symbol("lgtmd guide definition");
export interface GuideDefinition {
  readonly [definition]: true;
}
type Write<T> = (doc: Doc, context: T) => unknown | Promise<unknown>;
interface Definition {
  readonly page: Page;
  readonly prepare?: () => Prepared<unknown> | Promise<Prepared<unknown>>;
  readonly write: Write<unknown>;
}
const definitions = new WeakMap<object, Definition>();

function copyPage(page: Page): Page {
  if (!validId(page.id))
    throw new TypeError(`Invalid document ID: ${String(page.id)}`);
  singleLine(page.title, "Document title");
  return Object.freeze({ id: page.id, title: page.title });
}

/** Declare a document. Importing does not execute application code.
 * Authoring callback return values are ignored; only explicit checks are evidence.
 */
export function guide<T>(
  page: Page & { readonly prepare: () => Prepared<T> | Promise<Prepared<T>> },
  write: Write<T>,
): GuideDefinition;
export function guide(
  page: Page & { readonly prepare?: never },
  write: (doc: Doc) => unknown | Promise<unknown>,
): GuideDefinition;
export function guide(
  page: Page & {
    readonly prepare?: () => Prepared<unknown> | Promise<Prepared<unknown>>;
  },
  write: Write<unknown>,
): GuideDefinition {
  const identity = copyPage(page);
  if (typeof write !== "function")
    throw new TypeError("Guide requires an authoring callback");
  if (page.prepare !== undefined && typeof page.prepare !== "function")
    throw new TypeError("Guide preparation must be a callback");
  const result = Object.freeze({ [definition]: true as const });
  definitions.set(result, { page: identity, prepare: page.prepare, write });
  return result;
}

/** Both failures stay available in their original order and identity. */
export class GuideRunError extends AggregateError {
  readonly primary: unknown;
  readonly cleanup: unknown;

  constructor(primary: unknown, cleanup: unknown) {
    super([primary, cleanup], "Guide authoring and cleanup both failed", {
      cause: primary,
    });
    this.name = "GuideRunError";
    this.primary = primary;
    this.cleanup = cleanup;
  }
}

/** Execute native authoring, then cleanup, then freeze an eligible document. */
export async function runGuide(
  guideDefinition: GuideDefinition,
): Promise<FrozenDocument> {
  const registered =
    typeof guideDefinition === "object" && guideDefinition !== null
      ? definitions.get(guideDefinition)
      : undefined;
  if (!registered)
    throw new TypeError("Expected a guide declared by this SDK instance");
  const doc = new Doc(registered.page.id, registered.page.title);
  // Preparation owns its own partial failure. No cleanup has been acquired yet.
  const prepared = registered.prepare ? await registered.prepare() : undefined;
  if (
    prepared !== undefined &&
    (prepared === null ||
      typeof prepared !== "object" ||
      !Object.hasOwn(prepared, "context") ||
      (prepared.cleanup !== undefined &&
        typeof prepared.cleanup !== "function"))
  ) {
    throw new TypeError("Preparation must return { context, cleanup? }");
  }
  if (registered.prepare && prepared === undefined)
    throw new TypeError("Preparation must return { context, cleanup? }");
  // Acquire cleanup once. Author code may still hold and mutate the project's
  // preparation result, but cannot replace this acquired capability.
  const context = prepared?.context;
  const cleanup = prepared?.cleanup;

  let primary: unknown;
  let failed = false;
  let document: FrozenDocument | undefined;
  try {
    await registered.write(doc, context);
    document = doc.finish();
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await cleanup?.call(prepared);
  } catch (cleanupError) {
    if (failed) throw new GuideRunError(primary, cleanupError);
    throw cleanupError;
  }
  if (failed) throw primary;
  return document!;
}

/** The supplying host owns this context's setup and teardown. */
export async function runGuideWithContext<T>(
  page: Page,
  context: T,
  write: Write<T>,
): Promise<FrozenDocument> {
  const definition = guide(
    { ...copyPage(page), prepare: () => ({ context }) },
    write,
  );
  return runGuide(definition);
}
