import { deepFreeze, freezeJson, singleLine, validId } from "./model.js";
import type {
  FrozenDocument,
  FrozenResource,
  Json,
  Node,
  Page,
  Part,
  Reference,
  Scalar,
} from "./model.js";

const identity = Symbol("lgtmd target");
const presentation = Symbol("lgtmd presentation");
export interface Target {
  readonly [identity]: Reference["kind"];
}
export interface Block extends Target {
  readonly [identity]: "block";
}
type FrozenValue<T> = T extends object
  ? { readonly [Key in keyof T]: FrozenValue<T[Key]> }
  : T;
export interface Observation<T extends Json = Json> extends Target {
  readonly [identity]: "observation";
  readonly value: FrozenValue<T>;
}
export interface Check extends Target {
  readonly [identity]: "claim";
}
export interface Presentation {
  readonly [presentation]: true;
}
export interface Asset extends Target {
  readonly [identity]: "resource";
  link(label: string): Presentation;
}
export interface ImageAsset extends Asset {
  embed(alt: string): Presentation;
}
export interface CodeAsset extends Asset {
  code(): Presentation;
}
export type Content = Scalar | Observation | Presentation;
export type Markdown = (
  strings: TemplateStringsArray,
  ...values: Content[]
) => Block;
export type Note = (
  strings: TemplateStringsArray,
  ...values: Content[]
) => void;

export interface ResourceOptions {
  readonly producer?: string;
  readonly profile?: string;
}
export interface ImageOptions extends ResourceOptions {
  readonly mediaType?:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "image/gif"
    | "image/svg+xml";
}
export interface FileOptions extends ResourceOptions {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly extension: string;
}

const targets = new WeakMap<object, { owner: Doc; reference: Reference }>();
const presentations = new WeakMap<object, { owner: Doc; part: Part }>();

/** Dedent template literals without inspecting or changing interpolated values. */
function dedent(strings: readonly string[]): string[] {
  let index = 0;
  let marker = `\uE000${index}\uE001`;
  while (strings.some((text) => text.includes(marker))) {
    index += 1;
    marker = `\uE000${index}\uE001`;
  }
  const lines = strings.join(marker).replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() === "") lines.shift();
  if (lines.at(-1)?.trim() === "") lines.pop();
  const nonempty = lines.filter((line) => line.trim() !== "");
  const indent =
    nonempty.length === 0
      ? 0
      : Math.min(...nonempty.map((line) => /^[ \t]*/.exec(line)![0].length));
  return lines
    .map((line) =>
      line.slice(Math.min(indent, /^[ \t]*/.exec(line)![0].length)),
    )
    .join("\n")
    .split(marker);
}

export class Doc {
  #page?: Page;
  #finished = false;
  #ids = new Map<string, Reference["kind"]>();
  #nodes: Node[] = [];
  #observations: { id: string; value: Json }[] = [];
  #checks: { id: string; kind: "predicate"; passed: true }[] = [];
  #resources: FrozenResource[] = [];
  #errors: unknown[] = [];
  #pending = 0;
  #blocks = 0;
  #notes = 0;

  constructor(id?: string, title?: string) {
    if (id !== undefined || title !== undefined)
      this.page({ id: id!, title: title! });
    Object.freeze(this);
  }

  #open(): void {
    if (this.#finished) throw new Error("Document is already finished");
  }

  #guard<T>(operation: () => T): T {
    this.#open();
    try {
      return operation();
    } catch (error) {
      this.#errors.push(error);
      throw error;
    }
  }

  page(page: Page): void {
    this.#guard(() => {
      if (this.#page) throw new Error("Document identity can only be set once");
      if (!validId(page.id))
        throw new TypeError(`Invalid document ID: ${String(page.id)}`);
      singleLine(page.title, "Document title");
      this.#page = Object.freeze({ id: page.id, title: page.title });
    });
  }

  #reserve(id: string, kind: Reference["kind"]): Reference {
    if (!validId(id)) throw new TypeError(`Invalid evidence ID: ${String(id)}`);
    if (this.#ids.has(id)) throw new Error(`Duplicate evidence ID: ${id}`);
    this.#ids.set(id, kind);
    return Object.freeze({ id, kind });
  }

  #target<T extends Target>(reference: Reference, properties: object = {}): T {
    const target = Object.freeze({ [identity]: reference.kind, ...properties });
    targets.set(target, { owner: this, reference });
    return target as T;
  }

  #reference(target: Target): Reference {
    const found =
      typeof target === "object" && target !== null
        ? targets.get(target)
        : undefined;
    if (!found || found.owner !== this)
      throw new Error("Foreign or forged document handle");
    return found.reference;
  }

  #presentation(part: Part): Presentation {
    const value = Object.freeze({ [presentation]: true as const });
    presentations.set(value, { owner: this, part });
    return value;
  }

  #parts(
    strings: TemplateStringsArray,
    values: readonly Content[],
    literalKind: "markdown" | "text" = "markdown",
  ): Part[] {
    if (
      !Array.isArray(strings) ||
      strings.length !== values.length + 1 ||
      !strings.every((value) => typeof value === "string")
    ) {
      throw new TypeError(
        "Markdown and notes must be called as tagged templates",
      );
    }
    const literals = dedent(strings);
    const parts: Part[] = [];
    for (let index = 0; index < literals.length; index += 1) {
      const literal = literals[index]!;
      if (literal !== "") parts.push({ kind: literalKind, text: literal });
      if (index >= values.length) continue;
      const value = values[index]!;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        freezeJson(value);
        parts.push({ kind: "text", text: String(value) });
      } else if (typeof value === "object" && value !== null) {
        const view = presentations.get(value);
        if (view) {
          if (view.owner !== this)
            throw new Error("Foreign document presentation");
          if (literalKind === "text" && view.part.kind === "code")
            throw new TypeError(
              "Code resource presentations belong in Markdown blocks, not contributor notes",
            );
          parts.push(view.part);
        } else {
          const reference = this.#reference(value as Observation);
          if (reference.kind !== "observation")
            throw new TypeError(
              "Interpolate an observation or an explicit resource presentation",
            );
          parts.push({ kind: "reference", target: reference });
        }
      } else {
        throw new TypeError(
          "Unsupported Markdown interpolation; observe JSON values or use a typed resource presentation",
        );
      }
    }
    return parts;
  }

  readonly md: Markdown = (strings, ...values) =>
    this.#guard(() => {
      const parts = this.#parts(strings, values);
      // A template is one authored block. The native Markdown-parts API also
      // supports fragments, so terminate this block before compilation.
      parts.push({ kind: "markdown", text: "\n\n" });
      const reference = this.#reserve(
        `block-${String(++this.#blocks).padStart(4, "0")}`,
        "block",
      );
      this.#nodes.push({ id: reference.id, kind: "markdown", parts });
      return this.#target<Block>(reference);
    });

  section(id: string, title: string): Block {
    return this.#guard(() => {
      singleLine(title, "Section title");
      const reference = this.#reserve(id, "block");
      this.#blocks += 1;
      this.#nodes.push({ id, kind: "heading", level: 2, text: title });
      return this.#target<Block>(reference);
    });
  }

  observe<T extends Json>(id: string, value: T): Observation<T> {
    return this.#guard(() => {
      const frozen = freezeJson(value);
      const reference = this.#reserve(id, "observation");
      this.#observations.push({ id, value: frozen });
      return this.#target<Observation<T>>(reference, { value: frozen });
    });
  }

  async check(
    id: string,
    assertion: () => void | Promise<void>,
  ): Promise<Check> {
    const reference = this.#guard(() => {
      if (typeof assertion !== "function")
        throw new TypeError("Check requires an assertion callback");
      return this.#reserve(id, "claim");
    });
    this.#pending += 1;
    try {
      const result: unknown = await assertion();
      if (result !== undefined)
        throw new TypeError(
          "Check callbacks must return void; assert behavior inside the callback",
        );
      this.#open();
      this.#checks.push({ id, kind: "predicate", passed: true });
      return this.#target<Check>(reference);
    } catch (error) {
      this.#errors.push(error);
      throw error;
    } finally {
      this.#pending -= 1;
    }
  }

  readonly note: Note = (strings, ...values) => {
    this.#appendNote(undefined, strings, values);
  };

  noteOn(target: Target): Note {
    const reference = this.#guard(() => this.#reference(target));
    return (strings, ...values) => {
      this.#appendNote(reference, strings, values);
    };
  }

  #appendNote(
    target: Reference | undefined,
    strings: TemplateStringsArray,
    values: readonly Content[],
  ): void {
    this.#guard(() => {
      const parts = this.#parts(strings, values, "text");
      const reference = this.#reserve(
        `note-${String(++this.#notes).padStart(4, "0")}`,
        "block",
      );
      this.#nodes.push(
        target
          ? { id: reference.id, kind: "note", target, parts }
          : { id: reference.id, kind: "note", parts },
      );
    });
  }

  #resource(
    id: string,
    bytes: Uint8Array,
    mime: string,
    extension: string,
    producer: string,
    profile: string,
    json?: Json,
  ): Reference {
    if (!(bytes instanceof Uint8Array))
      throw new TypeError("Resource bytes must be a Uint8Array");
    if (
      typeof mime !== "string" ||
      !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)
    )
      throw new TypeError("Resource requires a MIME type without parameters");
    if (typeof extension !== "string" || !/^[a-z0-9]{1,16}$/.test(extension))
      throw new TypeError(
        "Resource extension must be 1..16 lowercase letters or digits",
      );
    singleLine(producer, "Resource producer");
    singleLine(profile, "Resource profile");
    const reference = this.#reserve(id, "resource");
    this.#resources.push({
      id,
      mime,
      extension,
      producer,
      profile,
      bytes: Array.from(bytes),
      ...(json !== undefined ? { json } : {}),
    });
    return reference;
  }

  #asset(reference: Reference, extras: object = {}): Asset {
    return this.#target<Asset>(reference, {
      link: (label: string) =>
        this.#guard(() => {
          singleLine(label, "Resource link label");
          return this.#presentation({ kind: "link", target: reference, label });
        }),
      ...extras,
    });
  }

  #codeAsset(reference: Reference, language: string): CodeAsset {
    if (typeof language !== "string" || !/^[a-zA-Z0-9_+-]*$/.test(language))
      throw new TypeError("Code language must be a plain fence label");
    return this.#asset(reference, {
      code: () =>
        this.#guard(() =>
          this.#presentation({ kind: "code", target: reference, language }),
        ),
    }) as CodeAsset;
  }

  readonly assets = Object.freeze({
    image: (
      id: string,
      bytes: Uint8Array,
      options: ImageOptions = {},
    ): ImageAsset =>
      this.#guard(() => {
        const mime = options.mediaType ?? "image/png";
        const extensions = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
          "image/svg+xml": "svg",
        };
        const extension = extensions[mime];
        if (!extension)
          throw new TypeError(`Unsupported image MIME type: ${mime}`);
        const reference = this.#resource(
          id,
          bytes,
          mime,
          extension,
          options.producer ?? "lgtmd/image",
          options.profile ?? "exact-v1",
        );
        return this.#asset(reference, {
          embed: (alt: string) =>
            this.#guard(() => {
              singleLine(alt, "Image alternative text");
              return this.#presentation({
                kind: "image",
                target: reference,
                label: alt,
              });
            }),
        }) as ImageAsset;
      }),
    json: (id: string, value: Json): CodeAsset =>
      this.#guard(() => {
        const frozen = freezeJson(value);
        return this.#codeAsset(
          this.#resource(
            id,
            new Uint8Array(),
            "application/json",
            "json",
            "executable-docs/json",
            "json-pretty-v1",
            frozen,
          ),
          "json",
        );
      }),
    text: (id: string, value: string, language = "text"): CodeAsset =>
      this.#guard(() => {
        if (typeof value !== "string")
          throw new TypeError("Text resource requires a string");
        freezeJson(value);
        return this.#codeAsset(
          this.#resource(
            id,
            new TextEncoder().encode(value),
            "text/plain",
            "txt",
            "executable-docs/text",
            "utf8-v1",
          ),
          language,
        );
      }),
    file: (id: string, file: FileOptions): Asset =>
      this.#guard(() =>
        this.#asset(
          this.#resource(
            id,
            file.bytes,
            file.mediaType,
            file.extension,
            file.producer ?? "lgtmd/file",
            file.profile ?? "exact-v1",
          ),
        ),
      ),
  });

  /** Freeze once. Application/runner success and publication remain host responsibilities. */
  finish(): FrozenDocument {
    this.#open();
    this.#finished = true;
    if (this.#errors.length > 0)
      throw new AggregateError(
        this.#errors,
        "Document authoring failed; caught failures cannot produce accepted evidence",
      );
    if (this.#pending > 0)
      throw new Error("Document has pending checks; await every named check");
    if (!this.#page)
      throw new Error("Document identity is missing; call doc.page once");
    return deepFreeze({
      ...this.#page,
      nodes: this.#nodes,
      observations: this.#observations,
      checks: this.#checks,
      resources: this.#resources,
      bindings: [] as never[],
    });
  }
}
