/** JSON values are copied at registration; unsupported JavaScript values fail. */
export type Scalar = string | number | boolean;
export type Json =
  | null
  | Scalar
  | readonly Json[]
  | { readonly [key: string]: Json };

export interface Page {
  readonly id: string;
  readonly title: string;
}

/** Internal compiler input. Schema v1 is the incubation interoperability boundary. */
export interface Reference {
  readonly kind:
    | "observation"
    | "resource"
    | "block"
    | "claim"
    | "value"
    | "binding";
  readonly id: string;
}

export type Part =
  | { readonly kind: "text" | "markdown"; readonly text: string }
  | { readonly kind: "reference"; readonly target: Reference }
  | {
      readonly kind: "image" | "link";
      readonly target: Reference;
      readonly label: string;
    }
  | {
      readonly kind: "code";
      readonly target: Reference;
      readonly language: string;
    };

export type Node =
  | {
      readonly id: string;
      readonly kind: "markdown";
      readonly parts: readonly Part[];
    }
  | {
      readonly id: string;
      readonly kind: "heading";
      readonly level: number;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly kind: "note";
      readonly target?: Reference;
      readonly parts: readonly Part[];
    };

export interface FrozenResource {
  readonly id: string;
  readonly mime: string;
  readonly extension: string;
  readonly producer: string;
  readonly profile: string;
  readonly bytes: readonly number[];
  /** JSON assets use the shared Rust encoder instead of a host serializer. */
  readonly json?: Json;
}

export interface FrozenDocument extends Page {
  readonly nodes: readonly Node[];
  readonly observations: readonly {
    readonly id: string;
    readonly value: Json;
  }[];
  readonly checks: readonly {
    readonly id: string;
    readonly kind: "predicate";
    readonly passed: true;
  }[];
  readonly resources: readonly FrozenResource[];
  readonly bindings: readonly never[];
}

export interface CompilerInput {
  readonly schema_version: 1;
  readonly documents: readonly FrozenDocument[];
}

export function validId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9_-]{1,100}$/.test(id);
}

export function singleLine(
  value: unknown,
  name: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${name} must be nonempty single-line text`);
  }
}

/** Avoid JSON.stringify's silent omission, coercion, getters, and toJSON hooks. */
export function freezeJson(value: unknown): Json {
  const ancestors = new Set<object>();
  const copy = (input: unknown, path: string): Json => {
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") {
      // Under Unicode regexp semantics a valid surrogate pair is one scalar,
      // outside this range. TextEncoder would silently replace an unpaired one.
      if (/[\uD800-\uDFFF]/u.test(input)) {
        throw new TypeError(`Cannot freeze ${path}: unpaired UTF-16 surrogate`);
      }
      return input;
    }
    if (typeof input === "number") {
      if (
        !Number.isFinite(input) ||
        (Number.isInteger(input) && !Number.isSafeInteger(input)) ||
        Object.is(input, -0)
      ) {
        throw new TypeError(
          `Cannot freeze ${path}: number must be finite, safely represented, and not negative zero`,
        );
      }
      return input;
    }
    if (typeof input !== "object")
      throw new TypeError(`Cannot freeze ${path}: expected a JSON value`);
    if (ancestors.has(input))
      throw new TypeError(`Cannot freeze ${path}: cyclic value`);
    if (Object.getOwnPropertySymbols(input).length !== 0)
      throw new TypeError(`Cannot freeze ${path}: symbol keys are unsupported`);
    ancestors.add(input);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Array.isArray(input)) {
        if (
          Object.keys(descriptors).some(
            (key) =>
              key !== "length" &&
              (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length),
          )
        ) {
          throw new TypeError(
            `Cannot freeze ${path}: array has extra properties`,
          );
        }
        const result: Json[] = [];
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            !descriptor ||
            !("value" in descriptor) ||
            !descriptor.enumerable
          ) {
            throw new TypeError(
              `Cannot freeze ${path}[${index}]: sparse arrays and accessors are unsupported`,
            );
          }
          result.push(copy(descriptor.value, `${path}[${index}]`));
        }
        return Object.freeze(result);
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError(`Cannot freeze ${path}: expected a plain object`);
      const result: Record<string, Json> = {};
      for (const key of Object.keys(descriptors).sort()) {
        copy(key, `${path} property name`);
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(
            `Cannot freeze ${path}.${key}: nonenumerable properties and accessors are unsupported`,
          );
        }
        Object.defineProperty(result, key, {
          value: copy(descriptor.value, `${path}.${key}`),
          enumerable: true,
        });
      }
      return Object.freeze(result);
    } finally {
      ancestors.delete(input);
    }
  };
  return copy(value, "value");
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
