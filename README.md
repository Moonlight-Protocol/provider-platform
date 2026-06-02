<p align=center>
  <img alt=Moonlight src=https://moonlightprotocol.io/moonlight.png width=300px height=300px />
</p>

<h1 align=center>Privacy Provider Platform</h1>

Moonlight is the missing privacy layer for any blockchain, built on Stellar.
Privacy Providers are the regulatory-friendly third parties that onboard
end-users and facilitate transactions through a council-governed Privacy
Channel. This repository is the backend each Privacy Provider runs — a Deno HTTP
service backed by Postgres that authenticates operators, encrypts the provider's
Stellar signing key at rest, joins councils, and accepts entity KYC/KYB
submissions and bundles from end-users.

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

## Stack

- **Deno 2.7.9** runtime (pinned in `Dockerfile`; CI uses `v2.x`).
- **PostgreSQL 18** (image `postgres:18` in `docker-compose.yml`).
- **Stellar SDK** `@stellar/stellar-sdk@^15.0.1` and
  `@moonlight/moonlight-sdk@^0.8.0` for Soroban contract calls and bundle
  construction.
- **Oak** for HTTP, **Drizzle** for ORM/migrations, **Zod** for body validation.
- **OpenTelemetry** OTLP (optional, opt-in via `OTEL_DENO=true`).

## Self-hosting quick start (Docker)

The platform runs as two containers: PostgreSQL and the Deno app.

```bash
cp .env.example .env
# Fill SERVICE_AUTH_SECRET (see §Environment variables) and any other
# values you want to override. Defaults are dev-grade.

docker compose up -d
```

Postgres comes up on `localhost:5432` and the app on `localhost:3000`.

### Running migrations

By default `docker compose up -d` starts the app **without** running migrations.
Mount an entrypoint script to run them on boot:

```bash
cat > entrypoint.sh <<'EOF'
#!/bin/sh
set -e
deno task db:migrate
exec deno task serve
EOF
chmod +x entrypoint.sh

ENTRYPOINT_SCRIPT=$PWD/entrypoint.sh docker compose up -d
```

If no entrypoint is mounted, run migrations one-off against the live DB:

```bash
docker compose exec app deno task db:migrate
```

### Postgres only

To run just Postgres (e.g., when you want to run Deno locally):

```bash
docker compose up -d db
```

## Self-hosting (without Docker)

For operators who already have Postgres and Deno installed:

```bash
cp .env.example .env
# Edit DATABASE_URL to point at your Postgres and fill SERVICE_AUTH_SECRET.

deno task db:migrate
deno task serve
```

The app reads `PORT` from `.env` (default `3000`) and listens on
`http://localhost:$PORT`.

## Environment variables

The platform reads only **infrastructure and operational** config from the
environment. Privacy Provider Stellar keys, council references, and Soroban
contract IDs live in the database — never in env vars.

`.env.example` declares every variable below with the same shape. Cross-check
against `src/config/env.ts` and `src/config/network.ts` if you suspect drift.

### Environment

| Name        | Required | Default       | Purpose                                                                                                                                                         |
| ----------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`      | yes      | `3000`        | TCP port the app listens on.                                                                                                                                    |
| `MODE`      | yes      | `development` | `development` widens CORS (`*` allow-headers, localhost origins) and disables SSRF guards on the council-discover endpoint. Set to anything else in production. |
| `LOG_LEVEL` | no       | `INFO`        | `FATAL`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`.                                                                                                             |

### Database

| Name           | Required | Default | Purpose                                                                                                                                                              |
| -------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | yes      | (none)  | Postgres connection string. Example: `postgresql://admin:devpass@localhost:5432/provider_platform_db`. On Fly.io, provisioned by `fly postgres create` and attached. |

### Stellar

| Name                            | Required | Default     | Purpose                                                                                                                                                                                                                                 |
| ------------------------------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK`                       | yes      | (none)      | `mainnet`, `testnet`, or `local`. Also gates the Pay demo route — see Operational notes.                                                                                                                                                |
| `NETWORK_FEE`                   | yes      | (none)      | Base fee cap in stroops (integer). `1000000000` (100 XLM) for dev, `1000000` (0.1 XLM) on mainnet.                                                                                                                                      |
| `STELLAR_RPC_URL`               | no       | per-network | Override the Soroban RPC endpoint. Per-network defaults: mainnet → `https://soroban-rpc.mainnet.stellar.gateway.fm`, testnet → built-in Nodies provider, local → `http://localhost:8000/soroban/rpc`. Required if you run your own RPC. |
| `TRANSACTION_EXPIRATION_OFFSET` | no       | `1000`      | Ledger sequences ahead of the latest ledger when building transactions. ~83 minutes on testnet/mainnet (5s/ledger).                                                                                                                     |
| `EVENT_WATCHER_INTERVAL_MS`     | no       | `30000`     | Poll interval for the on-chain event watcher.                                                                                                                                                                                           |

### Service

| Name                  | Required | Default                  | Purpose                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SERVICE_DOMAIN`      | yes      | (none)                   | Public hostname this platform answers on. Used in operator JWT claims.                                                                                                                                                                                                                                                                           |
| `SERVICE_AUTH_SECRET` | yes      | (none)                   | 32 random bytes, base64-encoded. **Dual purpose**: signs operator/entity JWTs AND encrypts Privacy Provider Stellar secret keys at rest. Rotating it invalidates issued JWTs AND makes existing encrypted PP keys unreadable. Generate with `deno eval 'console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))'`. |
| `PROVIDER_BASE_URL`   | no       | `http://localhost:$PORT` | Externally reachable base URL for this Privacy Provider. Sent to councils on join so the council and pay-platform can call back. Set this when not on localhost.                                                                                                                                                                                 |

### Auth

| Name            | Required | Default | Purpose                                                           |
| --------------- | -------- | ------- | ----------------------------------------------------------------- |
| `CHALLENGE_TTL` | yes      | (none)  | Challenge nonce lifetime in seconds. `900` (15m) is the standard. |
| `SESSION_TTL`   | yes      | (none)  | JWT session lifetime in seconds. `21600` (6h) is the standard.    |

### Mempool

The provider mempool batches bundles before submission. Tune capacity and
intervals to match expected throughput.

| Name                                | Required | Default        | Purpose                                                                 |
| ----------------------------------- | -------- | -------------- | ----------------------------------------------------------------------- |
| `MEMPOOL_SLOT_CAPACITY`             | yes      | (none)         | Max simultaneous bundles in the mempool (positive integer).             |
| `MEMPOOL_EXPENSIVE_OP_WEIGHT`       | yes      | (none)         | Weight assigned to expensive (verifying) operations.                    |
| `MEMPOOL_CHEAP_OP_WEIGHT`           | yes      | (none)         | Weight assigned to cheap (submission) operations.                       |
| `MEMPOOL_EXECUTOR_INTERVAL_MS`      | yes      | (none)         | How often the executor picks up bundles, in ms.                         |
| `MEMPOOL_VERIFIER_INTERVAL_MS`      | yes      | (none)         | How often the verifier re-checks pending bundles, in ms.                |
| `MEMPOOL_TTL_CHECK_INTERVAL_MS`     | yes      | (none)         | How often expired bundles are swept, in ms.                             |
| `MEMPOOL_MAX_RETRY_ATTEMPTS`        | yes      | (none)         | Max attempts before a bundle is marked failed (positive integer).       |
| `MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS` | no       | `0` (disabled) | Auto-expire bundles older than this many ms on startup. `0` keeps them. |

### Bundle

| Name                    | Required | Default | Purpose                                                         |
| ----------------------- | -------- | ------- | --------------------------------------------------------------- |
| `BUNDLE_MAX_OPERATIONS` | yes      | (none)  | Hard cap on operations per submitted bundle (positive integer). |

### CORS

| Name              | Required | Default | Purpose                                                                                                                                                              |
| ----------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS` | no       | (empty) | Comma-separated origins allowed cross-origin. Localhost is always allowed when `MODE=development`. Set this to your operator and entity frontend URLs in production. |

### OpenTelemetry (optional)

OTEL is read directly by the Deno runtime — there are no `Deno.env.get` calls
for these in the app code. Enable by setting `OTEL_DENO=true`.

| Name                          | Required | Default | Purpose                                                                                      |
| ----------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `OTEL_DENO`                   | no       | unset   | `true` enables Deno's built-in OpenTelemetry instrumentation.                                |
| `OTEL_SERVICE_NAME`           | no       | unset   | Logical service name in traces.                                                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no       | unset   | OTLP collector URL (`http://localhost:4318` for local Jaeger; Grafana Cloud Tempo for prod). |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | no       | unset   | `http/protobuf` for HTTP OTLP.                                                               |
| `OTEL_EXPORTER_OTLP_HEADERS`  | no       | unset   | OTLP collector auth, e.g. `Authorization=Basic <base64>` for Grafana Cloud Tempo.            |

### Waitlist (optional)

| Name                  | Required | Default | Purpose                                                                                                                    |
| --------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_WEBHOOK_URL` | no       | unset   | Discord webhook fired (best-effort, non-blocking) when a wallet posts to `POST /api/v1/waitlist`. Unset = no notification. |

### Internal (do not set as a self-hoster)

`PAY_DEMO_ENABLED` opens `POST /api/v1/pay/demo/simulate-kyc` on non-local
`NETWORK`s. Self-hosters should leave it unset; it exists only for internal
testnet/dev environments.

## Initial setup

This walks the platform through "fresh deploy" to "operator can submit bundles
on behalf of approved end-users."

### 1. Deploy + migrate

Deploy with the env vars from §Environment variables set, then run migrations:

```bash
deno task db:migrate
```

Migrations live in `src/persistence/drizzle/migration/` and the journal at
`src/persistence/drizzle/migration/meta/_journal.json`. On Fly.io they run as
the `release_command` on every deploy (see §Deploy).

### 2. Operator authenticates

The operator's wallet completes a SEP-43-style challenge/verify against the
dashboard auth endpoints. Any wallet that completes the challenge gets an
operator JWT — see Operational notes for the accepted-risk caveat.

```
POST /api/v1/dashboard/auth/challenge   { publicKey }            → { nonce }
POST /api/v1/dashboard/auth/verify      { publicKey, nonce, signature } → { token }
```

The recommended client UI is
[provider-console](https://github.com/Moonlight-Protocol/provider-console).

### 3. Register a Privacy Provider

With the operator JWT, register a Privacy Provider. The PP secret key is
encrypted at rest with `SERVICE_AUTH_SECRET`.

```
POST /api/v1/dashboard/pp/register      { secretKey, derivationIndex?, label? }
GET  /api/v1/dashboard/pp/list                                    (operator JWT)
```

### 4. Discover and join a council

Resolve a council by URL, then join it from this PP.

```
POST /api/v1/dashboard/council/discover   { councilUrl }          (operator JWT)
POST /api/v1/providers/:ppPublicKey/council/join                  (operator JWT + ownership)
GET  /api/v1/providers/:ppPublicKey/council/membership            (operator JWT + ownership)
POST /api/v1/providers/:ppPublicKey/council/membership            (operator JWT + ownership; resyncs from council)
```

The council records this Privacy Provider's address and channel-auth contract
IDs land in the database via the resulting membership row.

### 5. Entities self-register (any wallet, any time)

As of PR #107, end-user wallets self-register their KYC/KYB entity for any
Privacy Provider without operator approval. The submitter proves wallet
ownership by signing a single-use nonce; on success the entity is created or
promoted to `APPROVED` and a `USER`-type account is provisioned.

```
POST /api/v1/providers/:ppPublicKey/entities/challenge  { pubkey }
                                                        → { nonce }
POST /api/v1/providers/:ppPublicKey/entities  { pubkey, name, jurisdictions, signedChallenge }
                                              → 201 { entityId, status: "APPROVED" }
```

This is a deliberate design choice tied to the platform's "any wallet can KYC
itself with any PP" stance. The PP must already exist (the route mount checks
this); the JWT is intentionally not required.

### 6. Entities authenticate for bundle submission

End-users (entities) authenticate to the platform via SEP-10 to submit bundles.
The bundle endpoints below carry the entity JWT, not the operator JWT.

```
GET  /api/v1/stellar/auth                                  (SEP-10 challenge)
POST /api/v1/stellar/auth                                  (SEP-10 verify → entity JWT)

POST /api/v1/providers/:ppPublicKey/entity/bundles         (entity JWT)
GET  /api/v1/providers/:ppPublicKey/entity/bundles         (entity JWT)
GET  /api/v1/providers/:ppPublicKey/entity/bundles/:bundleId  (entity JWT)
```

## Database migrations

Migrations are managed by Drizzle.

```bash
deno task db:migrate    # apply pending migrations
deno task db:generate   # generate a new migration from schema diff
deno task db:studio     # open Drizzle Studio against DATABASE_URL
```

The `_journal.json` orders migrations by a strictly monotonic `when` timestamp;
Drizzle enforces this at runtime and CI fails on out-of-order entries. Migration
`.sql` files are sometimes gitignored on other platforms — in this repo they are
committed under `src/persistence/drizzle/migration/`.

Schema details are in [`docs/database-schema.md`](docs/database-schema.md).

## Deploy: Fly.io (worked example)

Our testnet and mainnet instances both deploy on Fly.io. Configuration is split
per environment: `fly.testnet.toml` and `fly.mainnet.toml`.

### Workflow trigger

Both `.github/workflows/deploy-testnet.yml` and
`.github/workflows/deploy-mainnet.yml` run on `push` to `main`:

- testnet → Fly app `moonlight-beta-privacy-provider-a` in `ams` + `gru`.
- mainnet → Fly app `moonlight-mainnet-provider` in `ams`.

Each workflow runs `flyctl deploy --remote-only --config fly.<network>.toml`,
falls back to destroy-and-redeploy if the first attempt fails, then prunes to
exactly one machine per region.

### Migrations on deploy

Both Fly configs declare
`release_command = "deno run -A --node-modules-dir
npm:drizzle-kit migrate"`.
Drizzle runs against the attached Postgres before the new release starts taking
traffic; a failed migration aborts the release.

### Required Fly secrets

`fly.<network>.toml` `[env]` pre-fills the non-sensitive variables (`PORT`,
`MODE`, `NETWORK`, `NETWORK_FEE`, `CHALLENGE_TTL`, `SESSION_TTL`, `MEMPOOL_*`,
`BUNDLE_MAX_OPERATIONS`, `TRANSACTION_EXPIRATION_OFFSET`, `OTEL_*`). The rest
must be set as Fly secrets:

```bash
fly secrets set DATABASE_URL='postgresql://...' -a moonlight-beta-privacy-provider-a
fly secrets set SERVICE_AUTH_SECRET='<base64>'  -a moonlight-beta-privacy-provider-a
fly secrets set SERVICE_DOMAIN='provider-testnet.moonlightprotocol.io' -a moonlight-beta-privacy-provider-a
fly secrets set PROVIDER_BASE_URL='https://provider-testnet.moonlightprotocol.io' -a moonlight-beta-privacy-provider-a
fly secrets set ALLOWED_ORIGINS='https://provider-testnet.moonlightprotocol.io,https://council-testnet.moonlightprotocol.io' -a moonlight-beta-privacy-provider-a
fly secrets set STELLAR_RPC_URL='https://...' -a moonlight-mainnet-provider     # mainnet only
fly secrets set OTEL_EXPORTER_OTLP_ENDPOINT='https://...' -a moonlight-beta-privacy-provider-a
fly secrets set OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic ...' -a moonlight-beta-privacy-provider-a
```

`DATABASE_URL` is normally injected automatically by `fly postgres attach`.

### Release artifacts

`.github/workflows/auto-tag.yml` creates `v$(deno.json#version)` on any push
that changes `deno.json`. `.github/workflows/release.yml` builds and pushes a
container to `ghcr.io/moonlight-protocol/provider-platform:<tag>` on each tag
push, then triggers the local-dev end-to-end suite via repository dispatch.

## Deploy: other targets

Any container host that can run `docker compose up -d` with the env vars from
§Environment variables works. The container image is also published on each
release at `ghcr.io/moonlight-protocol/provider-platform`. Migrations are not
run automatically by the default `CMD` — mount an entrypoint that runs
`deno task db:migrate` before `deno task serve` (see §Self-hosting quick start).

## Observability

OTEL OTLP exporter is opt-in via `OTEL_DENO=true`. Point
`OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP-compatible collector:

- **Local development** — run Jaeger and set
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
- **Production (our pattern)** — Grafana Cloud Tempo. Set
  `OTEL_EXPORTER_OTLP_ENDPOINT` to the Tempo OTLP HTTP endpoint and
  `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64>` with the
  access-policy credential. Treat the headers as secret material.

`GET /api/v1/health` returns the platform version and bundled
`@moonlight/moonlight-sdk` version — useful as a smoke check after deploy.

## Operational notes

- **Operator JWT issuance is intentionally permissive.** Any wallet that
  completes `POST /api/v1/dashboard/auth/challenge` +
  `POST /api/v1/dashboard/auth/verify` receives a dashboard JWT — there is no
  operator allowlist in the verify step. Endpoints under
  `/api/v1/providers/:ppPublicKey/...` then enforce per-PP ownership via the
  `requirePpOwnership` middleware, so a wallet cannot act on a PP it does not
  own. Operator-allowlist hardening on the verify step is a known follow-up.

- **Entity self-registration auto-approves.**
  `POST /api/v1/providers/:ppPublicKey/entities` marks the entity `APPROVED` on
  submission (and promotes pending → approved if the wallet's account already
  exists). There is no operator approval step. Operators uncomfortable with this
  should not run this platform.

- **`/api/v1/pay/demo/*` is internal.** The demo simulate-KYC endpoint is
  registered only when `NETWORK=local` or `NETWORK=standalone`. Self-hosters
  should not set `PAY_DEMO_ENABLED=true`; the variable exists for our
  testnet/dev environments and is not a supported operator surface.

- **Legacy `/api/v1/dashboard/...` per-PP paths return 410 Gone** with the new
  URL-scoped equivalent in the body. They are a temporary migration aid and will
  be removed once metrics confirm zero traffic. See
  `src/http/v1/dashboard/routes.ts` for the full mapping. Two routes are
  bare-deleted (404, not 410): `POST /dashboard/bundles/expire` and the
  query-driven `GET /dashboard/bundles`.

- **`SERVICE_AUTH_SECRET` rotation is destructive.** It signs JWTs _and_
  encrypts PP secret keys at rest. Rotating it invalidates all sessions and
  makes existing encrypted PP keys unreadable. Treat as a one-shot at
  provisioning time.

- **Deploy troubleshooting** is documented separately in
  [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — Fly machine pruning, missing-env
  crash loops, contract-ID updates.

## Links

- [`docs/database-schema.md`](docs/database-schema.md) — ERD and schema notes.
- [`docs/service-development-guidelines.md`](docs/service-development-guidelines.md)
  — contributor patterns.
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — Fly deploy diagnostics.
- [provider-console](https://github.com/Moonlight-Protocol/provider-console) —
  the recommended operator UI.
- [soroban-core](https://github.com/Moonlight-Protocol/soroban-core) —
  Stellar/Soroban contract source.
- [local-dev](https://github.com/Moonlight-Protocol/local-dev) — automated
  multi-service local stack.
