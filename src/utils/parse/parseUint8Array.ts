type ParsedValue =
  | Uint8Array
  | string
  | number
  | boolean
  | null
  | undefined
  | ParsedValue[]
  | { [key: string]: ParsedValue };

export const parseUint8Array = (data: unknown): ParsedValue => {
  if (Array.isArray(data)) {
    return data.map(parseUint8Array);
  } else if (
    data &&
    typeof data === "object" &&
    Object.keys(data).every((k) => !isNaN(Number(k)))
  ) {
    return new Uint8Array(Object.values(data as Record<string, number>));
  }
  return data as ParsedValue;
};
