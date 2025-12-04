import uint8ArrayToBase64 from "@/utils/conversion/uint8ArrayToBase64.ts";

export default function getBase64Nonce(bytes: number): string {
  const nonceArray = new Uint8Array(bytes);
  crypto.getRandomValues(nonceArray);
  return uint8ArrayToBase64(nonceArray);
}
