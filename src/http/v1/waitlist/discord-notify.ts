import type { Logger } from "@/utils/logger/index.ts";

/**
 * Fire-and-forget Discord webhook notification for waitlist requests.
 */
export function notifyDiscord(
  email: string,
  wallet: string | null,
  source: string,
  deps: { log: Logger },
): void {
  const log = deps.log.scope("discordNotify");
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) {
    log.event("DISCORD_WEBHOOK_URL unset — skipping Discord notification");
    return;
  }

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
    log.error(err, "Discord notification failed");
  });
}
