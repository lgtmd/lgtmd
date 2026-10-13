import type { Reporter } from "@playwright/test/reporter";

function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

/** Playwright swallows reporter exceptions, so delegate errors become receipt failures. */
export class ReporterGuard {
  readonly errors: string[] = [];
  #pending = new Set<Promise<void>>();

  constructor(readonly reporters: readonly Reporter[] = []) {}

  #result(method: keyof Reporter, value: unknown): void {
    if (
      method === "onEnd" &&
      value !== null &&
      typeof value === "object" &&
      "status" in value &&
      value.status !== undefined &&
      value.status !== "passed"
    ) {
      this.errors.push(
        `onEnd: reporter requested ${String(value.status)} status`,
      );
    }
  }

  invoke(method: keyof Reporter, ...args: unknown[]): void {
    for (const reporter of this.reporters) {
      try {
        const callback = reporter[method];
        if (typeof callback !== "function") continue;
        const result = Reflect.apply(callback, reporter, args) as unknown;
        if (
          result &&
          typeof (result as PromiseLike<unknown>).then === "function"
        ) {
          let pending: Promise<void>;
          pending = Promise.resolve(result)
            .then((value: unknown) => {
              this.#result(method, value);
            })
            // Inspecting a returned status can itself throw (for example, a
            // custom reporter getter). Retain it just like a callback failure.
            .catch((error: unknown) => {
              this.errors.push(`${method}: ${describe(error)}`);
            })
            .finally(() => {
              this.#pending.delete(pending);
            });
          this.#pending.add(pending);
        } else {
          this.#result(method, result);
        }
      } catch (error) {
        this.errors.push(`${method}: ${describe(error)}`);
      }
    }
  }

  async settle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}
