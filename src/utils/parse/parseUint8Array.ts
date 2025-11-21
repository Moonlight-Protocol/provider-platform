export const parseUint8Array = (data: any): any => {
  if (Array.isArray(data)) {
    return data.map(parseUint8Array);
  } else if (
    data &&
    typeof data === "object" &&
    Object.keys(data).every((k) => !isNaN(Number(k)))
  ) {
    return new Uint8Array(Object.values(data)); // Convert object back to Uint8Array ✅
  }
  return data;
};
