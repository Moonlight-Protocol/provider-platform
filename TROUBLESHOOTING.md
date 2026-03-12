# Troubleshooting

## Failed Deploys

### Symptoms

- Deploy workflow shows "Deployment Complete" but the app is unreachable (502/503)
- Machines show `stopped` state in Fly.io dashboard
- `fly logs` shows crash-loop: repeated start → exit with code 1

### Diagnosis

```bash
# Check machine states
fly status -a moonlight-beta-privacy-provider-a

# Check recent logs (requires FLY_API_TOKEN or fly auth login)
fly logs -a moonlight-beta-privacy-provider-a

# Check machine events via API
curl -s -H "Authorization: Bearer $FLY_API_TOKEN" \
  "https://api.machines.dev/v1/apps/moonlight-beta-privacy-provider-a/machines" \
  | python3 -c "import sys,json; [print(f'{m[\"id\"]} | {m[\"state\"]} | {m[\"updated_at\"]}') for m in json.load(sys.stdin)]"
```

### Common Causes

#### Missing Environment Variable

**Error**: `Uncaught (in promise) Error: <VAR_NAME> is not loaded`

The app requires env vars set both in `fly.toml` (non-sensitive) and Fly secrets (sensitive). If a new env var is added to the code but not to Fly, the app will crash-loop.

**Required secrets** (set via `fly secrets set`):
- `DATABASE_URL` — Postgres connection string
- `PROVIDER_SK` — Provider Stellar secret key
- `OPEX_SECRET` — Operational expense account secret key
- `SERVICE_AUTH_SECRET` — JWT signing secret
- `CHANNEL_ASSET_CONTRACT_ID` — XLM SAC contract address

**Required env vars** (set in `fly.toml` `[env]`):
- `CHANNEL_CONTRACT_ID` — Privacy channel contract
- `CHANNEL_AUTH_ID` — Channel auth contract
- All other vars in the `[env]` section

**Fix**:
```bash
# Check which secrets exist
fly secrets list -a moonlight-beta-privacy-provider-a

# Set missing secret
fly secrets set VAR_NAME=value -a moonlight-beta-privacy-provider-a
```

Note: setting a secret triggers an automatic redeploy.

#### Crash Loop (max restart count reached)

**Error in logs**: `machine has reached its max restart count of 10`

The machine crashed 10 times and gave up. After fixing the root cause, you need to either:
- Set a secret (triggers redeploy automatically), or
- Manually redeploy: `fly deploy -a moonlight-beta-privacy-provider-a`

#### Health Check Passes But App Crashes Later

Blue/green deploy can mark a deployment as successful if the health check passes during the grace period, but the app crashes afterward (e.g., a deferred initialization fails). The deploy logs will show "Deployment Complete" while the machines are actually crash-looping.

**How to detect**: Check `fly status` or `fly logs` after deploy, not just the CI workflow result.

#### Stray Machines

Debug machines (e.g., `fly machine run ubuntu`) left running consume resources and can confuse deploy strategies.

**Check for strays**:
```bash
fly machines list -a moonlight-beta-privacy-provider-a
```

Look for machines with no process group or unexpected images. Destroy with:
```bash
fly machine destroy <machine-id> --force -a moonlight-beta-privacy-provider-a
```

### Contract ID Updates

When contracts are redeployed to testnet, the provider-platform needs updated contract IDs:

```bash
# After running deploy-testnet/deploy.sh, copy the output and run:
fly secrets set \
  CHANNEL_CONTRACT_ID=C... \
  CHANNEL_AUTH_ID=C... \
  CHANNEL_ASSET_CONTRACT_ID=C... \
  -a moonlight-beta-privacy-provider-a
```

The XLM SAC contract ID is deterministic per network:
```bash
stellar contract id asset --asset native --network testnet
# Testnet: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Logs

### Current: Fly CLI

```bash
# Real-time logs
fly logs -a moonlight-beta-privacy-provider-a

# Logs for a specific machine
fly logs -a moonlight-beta-privacy-provider-a -i <machine-id>
```

Limitation: logs are only available while machines are running or recently stopped. Crash logs from long-stopped machines may be unavailable.

### Persistent Logs: Fly.io Log Shipper

Fly.io has built-in log shipping (`fly logs ship`) that can send to various destinations (Logtail, Datadog, S3, etc.). For persistent logs that survive machine crashes, configure a log drain:

```bash
# Example with Logtail (free tier: 1 GB/month)
fly logs ship --logtail-token=<token> -a moonlight-beta-privacy-provider-a
```

Not needed yet — `fly logs` via CLI or dashboard is sufficient for current testnet usage. Consider adding when debugging becomes harder (more frequent deploys, multiple team members).
