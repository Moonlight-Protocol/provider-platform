type ParsedValue =
  | bigint
  | string
  | number
  | boolean
  | null
  | undefined
  | ParsedValue[]
  | { [key: string]: ParsedValue };

export const parseBigInt = (obj: unknown): ParsedValue => {
  if (typeof obj === "string" && /^\d+$/.test(obj)) {
    return BigInt(obj); // ✅ Convert string to BigInt
  }

  if (Array.isArray(obj)) {
    return obj.map(parseBigInt);
  }

  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, parseBigInt(v)])
    );
  }

  return obj as ParsedValue;
};
