export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    return typeof value === "bigint" ? value.toString() : value;
  });
}
