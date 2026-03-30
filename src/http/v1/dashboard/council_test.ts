import { assertEquals } from "jsr:@std/assert";
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";

const API = "http://localhost:3010/api/v1";

let _cachedToken: string | null = null;
async function getToken(): Promise<string> {
  if (_cachedToken) return _cachedToken;
  // Use provider SK from env to auth
  const sk = Deno.env.get("PROVIDER_SK");
  if (!sk) throw new Error("PROVIDER_SK env required");
  const kp = Keypair.fromSecret(sk);

  const c = await (await fetch(`${API}/dashboard/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp.publicKey() }),
  })).json();

  const nonce = c.data.nonce;
  const raw = Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0));
  const sig = btoa(String.fromCharCode(...kp.sign(Buffer.from(raw))));

  const v = await (await fetch(`${API}/dashboard/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, signature: sig, publicKey: kp.publicKey() }),
  })).json();

  _cachedToken = v.data.token as string;
  return _cachedToken!;
}

async function post(path: string, body: unknown, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("council discover: rejects missing councilUrl", async () => {
  const token = await getToken();
  const { status, body } = await post("/dashboard/council/discover", {}, token);
  assertEquals(status, 400);
  assertEquals(body.message, "councilUrl is required");
});

Deno.test("council discover: rejects non-HTTP URL", async () => {
  const token = await getToken();
  const { status, body } = await post("/dashboard/council/discover", { councilUrl: "ftp://evil.com" }, token);
  assertEquals(status, 400);
  assertEquals(body.message, "councilUrl must be a valid HTTP(S) URL");
});

Deno.test("council discover: rejects invalid URL", async () => {
  const token = await getToken();
  const { status, body } = await post("/dashboard/council/discover", { councilUrl: "not-a-url" }, token);
  assertEquals(status, 400);
  assertEquals(body.message, "councilUrl must be a valid HTTP(S) URL");
});

Deno.test("council discover: succeeds with valid council URL", async () => {
  const token = await getToken();
  const { status, body } = await post("/dashboard/council/discover", { councilUrl: "http://localhost:3015" }, token);
  assertEquals(status, 200);
  assertEquals(body.message, "Council discovered");
});

Deno.test("council discover: parses council ID from query param", async () => {
  const token = await getToken();
  const authId = (body: Record<string, unknown>) =>
    ((body.data as Record<string, unknown>)?.council as Record<string, unknown>)?.channelAuthId;

  const { status, body } = await post("/dashboard/council/discover", {
    councilUrl: `http://localhost:3015?council=${Deno.env.get("AUTH_ID")}`,
  }, token);
  assertEquals(status, 200);
  assertEquals(authId(body), Deno.env.get("AUTH_ID"));
});

Deno.test("council discover: rejects mismatched council ID", async () => {
  const token = await getToken();
  const { status, body } = await post("/dashboard/council/discover", {
    councilUrl: "http://localhost:3015?council=CWRONGIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  }, token);
  assertEquals(status, 400);
  assertEquals(body.message, "Council ID in URL does not match the council at this endpoint");
});
