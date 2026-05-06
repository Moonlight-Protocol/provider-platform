/**
 * Fire-and-forget Discord webhook notification for waitlist requests.
 * Logs a warning and skips if DISCORD_WEBHOOK_URL is not set — the
 * disappearance of that warning is the operational signal that the
 * dormant path flipped to live once the secret is provided.
 */
export function notifyDiscord(
  email: string,
  wallet: string | null,
  source: string,
): void {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(
      "[waitlist] DISCORD_WEBHOOK_URL unset — skipping Discord notification",
    );
    return;
  }

  // Fire-and-forget — do not await
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: "New Mainnet Invite Request",
        color: 5814783,
        fields: [
          { name: "Email", value: email, inline: true },
          { name: "Wallet", value: wallet ?? "N/A", inline: true },
          { name: "Source", value: source, inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  }).catch((err) => {
    console.warn("[waitlist] Discord notification failed:", err.message);
  });
}
