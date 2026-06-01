import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";

/**
 * Verifies an Ed25519 signature over a Stellar wallet challenge nonce.
 *
 * Supports the three encodings produced by the wallet ecosystem in current
 * use:
 *   - SEP-43 (Freighter signMessage): sign(SHA256(0x00 0x00 || len(msg) BE32 || msg))
 *   - SEP-53 (Stellar Signed Message): sign(SHA256("Stellar Signed Message:\n" + msg))
 *   - Raw bytes (SDK direct-sign): sign(base64-decoded nonce)
 *
 * The signature is accepted in hex (SEP-53/signMessage shape) or base64 (raw).
 * Returns true on success; false otherwise.
 */
export async function verifyStellarSignature(
  publicKey: string,
  nonce: string,
  signature: string,
): Promise<boolean> {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);

    const sigBuffer = /^[0-9a-f]+$/i.test(signature)
      ? Buffer.from(signature, "hex")
      : Buffer.from(signature, "base64");
    const nonceBytes = Buffer.from(nonce, "utf-8");

    // SEP-43
    const sep43Header = Buffer.alloc(6);
    sep43Header[0] = 0x00;
    sep43Header[1] = 0x00;
    sep43Header.writeUInt32BE(nonceBytes.length, 2);
    const sep43Payload = Buffer.concat([sep43Header, nonceBytes]);
    const sep43Hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", sep43Payload),
    );
    if (keypair.verify(sep43Hash, sigBuffer)) return true;

    // SEP-53
    const sep53Prefix = "Stellar Signed Message:\n";
    const sep53Payload = Buffer.concat([
      Buffer.from(sep53Prefix, "utf-8"),
      nonceBytes,
    ]);
    const sep53Hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", sep53Payload),
    );
    if (keypair.verify(sep53Hash, sigBuffer)) return true;

    // Raw bytes (SDK / E2E)
    const rawNonce = Buffer.from(nonce, "base64");
    return keypair.verify(rawNonce, sigBuffer);
  } catch {
    return false;
  }
}
