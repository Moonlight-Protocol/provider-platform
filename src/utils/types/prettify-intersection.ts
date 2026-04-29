/**
 * Prettifies an intersection type by creating a new type
 * that combines all properties into a single object.
 * @template T - The intersection type to prettify.
 * @returns A prettified version of the intersection type.
 * @example
 * ```ts
 * type A = { a: number };
 * type B = { b: string };
 * type C = PrettifyIntersection<A & B>;
 * // Result: { a: number; b: string; }
 * ```
 */
export type PrettifyIntersection<T> =
  & {
    [K in keyof T]: T[K];
  }
  // deno-lint-ignore ban-types
  & {};
