export default function (u8: Uint8Array): string {
  // Convert Uint8Array to string, then use btoa
  const binaryString = Array.from(u8)
    .map((byte) => String.fromCharCode(byte))
    .join("");
  return btoa(binaryString);
}
