# Database Schema Documentation

This document describes the database schema for the Provider Platform, including entity relationships, data types, and constraints.

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    users {
        text id PK
        enum status "UNVERIFIED, APPROVED, PENDING, BLOCKED"
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    accounts {
        text id PK
        enum type "OPEX, USER"
        text user_id FK
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    sessions {
        text id PK
        enum status "ACTIVE, INACTIVE"
        text jwt_token "nullable"
        text account_id FK
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    challenges {
        text id PK
        text account_id FK
        enum status "VERIFIED, UNVERIFIED"
        timestamp ttl
        text tx_hash "unique"
        text tx_xdr
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    operations_bundles {
        text id PK
        enum status "PENDING, COMPLETED, EXPIRED"
        timestamp ttl
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    transactions {
        text id PK
        enum status "UNVERIFIED, VERIFIED"
        timestamp timeout
        text ledger_sequence
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    utxos {
        text id PK
        text account_id FK
        text spent_by_account_id
        text created_at_bundle_id FK
        text spent_at_bundle_id FK
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }
    bundles_transactions {
        text bundle_id PK,FK
        text transaction_id PK,FK
        timestamp created_at
        timestamp updated_at
        text created_by
        text updated_by
        timestamp deleted_at
    }

    users ||--o{ accounts : "has"
    accounts ||--o{ sessions : "has"
    accounts ||--o{ challenges : "has"
    accounts ||--o{ utxos : "has"
    operations_bundles ||--o{ bundles_transactions : "has"
    transactions ||--o{ bundles_transactions : "has"
    operations_bundles ||--o{ utxos : "creates"
    operations_bundles ||--o{ utxos : "spends"
```

## Entity Descriptions

### Base Fields

All entities inherit the following base fields for auditing and soft delete:

- `created_at` (timestamp with time zone): Automatically set when record is created
- `updated_at` (timestamp with time zone): Automatically updated when record is modified
- `created_by` (text, nullable): User/system that created the record
- `updated_by` (text, nullable): User/system that last updated the record
- `deleted_at` (timestamp with time zone, nullable): Timestamp when record was soft deleted (NULL if active)

### Users

Represents system users in the platform.

**Fields:**
- `id` (text, PK): Unique user identifier
- `status` (enum): User status - UNVERIFIED, APPROVED, PENDING, or BLOCKED

**Relationships:**
- Has many `accounts` (1:N)

### Accounts

Represents user accounts that can hold UTXOs.

**Fields:**
- `id` (text, PK): Unique account identifier
- `type` (enum): Account type - OPEX or USER
- `user_id` (text, FK): Reference to the user who owns this account

**Relationships:**
- Belongs to `user` (N:1)
- Has many `sessions` (1:N)
- Has many `challenges` (1:N)
- Has many `utxos` (1:N)

### Sessions

Represents account authentication sessions.

**Fields:**
- `id` (text, PK): Unique session identifier
- `status` (enum): Session status - ACTIVE or INACTIVE
- `jwt_token` (text, nullable): JWT token for the session
- `account_id` (text, FK): Reference to the account that owns this session

**Relationships:**
- Belongs to `account` (N:1)

### Challenges

Represents authentication challenges for accounts.

**Fields:**
- `id` (text, PK): Unique challenge identifier
- `account_id` (text, FK): Reference to the account that owns this challenge
- `status` (enum): Challenge status - VERIFIED or UNVERIFIED
- `ttl` (timestamp with time zone): Time-to-live expiration timestamp
- `tx_hash` (text, unique): Transaction hash associated with the challenge
- `tx_xdr` (text): Transaction XDR (base64-encoded transaction data)

**Relationships:**
- Belongs to `account` (N:1)

### Operations Bundles

Represents bundles of operations that can contain multiple transactions.

**Fields:**
- `id` (text, PK): Unique bundle identifier
- `status` (enum): Bundle status - PENDING, COMPLETED, or EXPIRED
- `ttl` (timestamp with time zone): Time-to-live expiration timestamp

**Relationships:**
- Has many `bundle_transactions` (1:N) - Junction table linking to transactions
- Can create `utxos` via `created_at_bundle_id` (1:N)
- Can spend `utxos` via `spent_at_bundle_id` (1:N)

### Transactions

Represents individual blockchain transactions.

**Fields:**
- `id` (text, PK): Unique transaction identifier
- `status` (enum): Transaction status - UNVERIFIED or VERIFIED
- `timeout` (timestamp with time zone): Transaction timeout timestamp
- `ledger_sequence` (text): Ledger sequence number

**Relationships:**
- Has many `bundle_transactions` (1:N) - Junction table linking to bundles
- Has many `utxos` (1:N)

### UTXOs

Represents Unspent Transaction Outputs (UTXOs) that can be spent.

**Fields:**
- `id` (text, PK): Unique UTXO identifier
- `account_id` (text, FK): Reference to the account that owns this UTXO
- `spent_by_account_id` (text, nullable): Account ID that spent this UTXO (if spent)
- `created_at_bundle_id` (text, FK, nullable): Reference to the bundle that created this UTXO
- `spent_at_bundle_id` (text, FK, nullable): Reference to the bundle that spent this UTXO

**Relationships:**
- Belongs to `account` (N:1) via `account_id`
- Belongs to `operations_bundle` (N:1) via `created_at_bundle_id` (when created)
- Belongs to `operations_bundle` (N:1) via `spent_at_bundle_id` (when spent)

### Bundles Transactions

Junction table representing the many-to-many relationship between operations bundles and transactions.

**Fields:**
- `bundle_id` (text, PK, FK): Reference to operations bundle
- `transaction_id` (text, PK, FK): Reference to transaction

**Relationships:**
- Belongs to `operations_bundle` (N:1)
- Belongs to `transaction` (N:1)

## Relationship Explanations

### User → Accounts (1:N)

A user can have multiple accounts. Each account is associated with a single user through the `user_id` foreign key. This allows users to manage multiple accounts for different purposes (e.g., OPEX accounts for operations, USER accounts for regular use).

### Account → Sessions (1:N)

An account can have multiple active sessions simultaneously. Each session is tied to a specific account and contains a JWT token for authentication. Sessions can be active or inactive, allowing for session management and revocation.

### Account → Challenges (1:N)

An account can have multiple authentication challenges. Challenges are used for verifying account identity and have a time-to-live (TTL) for security purposes. Each challenge can be in a verified or unverified state. Challenges include transaction hash (`tx_hash`) and transaction XDR (`tx_xdr`) for blockchain verification.

### Account → UTXOs (1:N)

An account can have multiple UTXOs (Unspent Transaction Outputs). UTXOs represent available funds or assets that can be spent. Each UTXO belongs to a single account and tracks which bundle created it and which bundle spent it (if applicable).

### Operations Bundle ↔ Transactions (N:M)

Operations bundles and transactions have a many-to-many relationship through the `bundles_transactions` junction table. This allows:
- A single bundle to contain multiple transactions
- A single transaction to be part of multiple bundles (if needed)

This design provides flexibility in grouping transactions into logical bundles for processing.

### Operations Bundle → UTXOs (1:N via created_at_bundle_id)

When a bundle creates UTXOs, the relationship is tracked through `created_at_bundle_id`. This allows tracing which bundle generated specific UTXOs, enabling audit trails and transaction history.

### Operations Bundle → UTXOs (1:N via spent_at_bundle_id)

When a bundle spends UTXOs, the relationship is tracked through `spent_at_bundle_id`. This allows tracking which bundle consumed specific UTXOs, maintaining a complete history of UTXO lifecycle.

### Transaction → UTXOs (1:N)

Transactions can create multiple UTXOs as outputs. This relationship tracks which UTXOs were created by which transaction, enabling transaction verification and UTXO validation.

## Data Types and Constraints

### Enums

- **user_status**: UNVERIFIED, APPROVED, PENDING, BLOCKED
- **account_type**: OPEX, USER
- **session_status**: ACTIVE, INACTIVE
- **challenge_status**: VERIFIED, UNVERIFIED
- **bundle_status**: PENDING, COMPLETED, EXPIRED
- **transaction_status**: UNVERIFIED, VERIFIED

### Timestamps

All timestamp fields use `timestamp with time zone` to ensure proper timezone handling and consistency across different server locations.

### Soft Delete

All entities support soft delete through the `deleted_at` field. When a record is deleted, `deleted_at` is set to the current timestamp instead of physically removing the record. This allows for:
- Data recovery
- Audit trails
- Historical data preservation

Queries should filter out soft-deleted records by checking `WHERE deleted_at IS NULL`.

### Primary Keys

All entities use `text` type for primary keys, providing flexibility in key generation strategies. The `bundles_transactions` table uses a composite primary key consisting of both `bundle_id` and `transaction_id`.

### Foreign Keys

Foreign key relationships enforce referential integrity:
- `accounts.user_id` → `users.id`
- `sessions.account_id` → `accounts.id`
- `challenges.account_id` → `accounts.id`
- `utxos.account_id` → `accounts.id`
- `utxos.created_at_bundle_id` → `operations_bundles.id`
- `utxos.spent_at_bundle_id` → `operations_bundles.id`
- `bundles_transactions.bundle_id` → `operations_bundles.id`
- `bundles_transactions.transaction_id` → `transactions.id`

