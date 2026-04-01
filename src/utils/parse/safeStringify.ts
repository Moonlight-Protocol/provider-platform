export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    return typeof value === "bigint" ? value.toString() : value;
  });
}

/**
 * Like JSON.stringify but returns undefined instead of throwing on
 * circular references, BigInt values, or other non-serializable data.
 */
export function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, v) => {
      return typeof v === "bigint" ? v.toString() : v;
    });
  } catch {
    return undefined;
  }
}
