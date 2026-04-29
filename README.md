<p align=center>
  <img alt=Moonlight src=https://moonlightprotocol.io/moonlight.png width=300px height=300px />
</p>

<h1 align=center>Privacy Provider Platform</h1>

Moonlight: the missing privacy layer, for any blockchain, built on Stellar.

Privacy Providers are a key component of Moonlight, providing a flexible,
regulatory-friendly 3rd party for user onboarding and transaction facilitation.

```mermaid
erDiagram
    Quorum ||--|{ "Privacy Channel" : "has many"
    "Privacy Channel" ||--|{ "Privacy Provider (bank, wallet, etc)" : "has many"
    End-user }|--|{ "Privacy Provider (bank, wallet, etc)" : "chooses, per tx"
    "Privacy Channel" {
        Address asset "e.g. XLM"
        i256 supply
    }
    "Privacy Provider (bank, wallet, etc)" {
        string provider_sk "Stellar account registered with Quorum"
        string opex_sk "Operating expense (treasury) account; pays fees & creates UTXOs"
        string url "Endpoint hosting Provider Platform API"
    }
```

## Docker

The provider platform runs as two containers: PostgreSQL and the Deno app.

### Quick start

```bash
cp .env.example .env
# Fill in .env with your keys and contract IDs

docker compose up -d
```

This starts PostgreSQL and the provider app on port 3000.

### Running migrations

The Dockerfile supports an optional entrypoint script mounted at
`/app/entrypoint.sh`. If present, it runs instead of the default
`deno task serve`, allowing you to run migrations or other setup before
starting.

```bash
ENTRYPOINT_SCRIPT=/path/to/your/entrypoint.sh docker compose up -d
```

Example entrypoint that runs migrations:

```bash
#!/bin/sh
set -e
deno task db:migrate
exec deno task serve
```

If no entrypoint is mounted, the app starts directly without migrations.

### DB only

To run just PostgreSQL (e.g. when running the app with Deno locally):

```bash
docker compose up -d db
```

Then run the app directly:

```bash
deno task db:migrate
deno task serve
```

## Run locally (without Docker)

Copy `.env.example` to `.env` and fill in the values. You will need:

- A local Stellar network: `stellar container start local`
- Deployed contracts from
  [soroban-core](https://github.com/Moonlight-Protocol/soroban-core)
- A provider account registered with the quorum contract
- A treasury (OpEx) account for fees

See the [local-dev](https://github.com/Moonlight-Protocol/local-dev) repo for
automated setup.

```bash
docker compose up -d db
deno task db:migrate
deno task serve
```

## Deploy (to testnet)

We deploy to [fly.io](https://fly.io). Config is split per environment:
`fly.testnet.toml` and `fly.mainnet.toml`.

The platform reads only **infrastructure and operational** config from the
environment — never Privacy Provider keys, council references, or contract IDs.
Those are stored in the database via the dashboard API
(`POST /api/v1/dashboard/pp/register`) and the council join flow
(`POST /api/v1/dashboard/council/join`). The encryption key for stored secrets
at rest is `SERVICE_AUTH_SECRET`.

To deploy: push to GitHub, then deploy from your Fly.io dashboard (branch:
`dev`). Set these secrets:

- `DATABASE_URL`: provisioned by `fly postgres create` and attached
- `SERVICE_AUTH_SECRET`: generate with
  `node -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"`
- `ALLOWED_ORIGINS` (optional): comma-separated list of allowed CORS origins.
  Falls back to default Tigris URLs if not set.

After deploying, SSH in and run migrations:

```bash
fly console ssh -s
deno task db:migrate
```

Once the platform is up, register a Privacy Provider via the provider-console
wallet flow (challenge-response auth → register PP → join a council). The
encrypted PP key lands in the `payment_providers` table; council membership
lands in `council_memberships`.

## Dashboard admin note

`POST /api/v1/dashboard/bundles/expire` is a mutating operational endpoint.
Today, dashboard JWT issuance intentionally allows any wallet that can complete
the challenge flow (it does not enforce an operator allowlist in `verify`). This
risk is currently accepted for operator workflows, and stronger authorization
hardening is planned as a follow-up.
