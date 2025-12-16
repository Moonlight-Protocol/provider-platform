# Service Development Guidelines

This document describes the patterns and best practices for service development in the Provider Platform, ensuring consistency, maintainability, and code quality.

## Fundamental Principles

### 1. KISS (Keep It Simple, Stupid)
- **Prioritize simplicity over complexity**
- Avoid over-engineering
- Keep functions small and focused
- Don't create unnecessary abstractions

### 2. DRY (Don't Repeat Yourself)
- **Eliminate code duplication**
- Extract repeated logic into reusable functions
- Use generic functions when appropriate
- Identify repetitive patterns and abstract them

### 3. Single Responsibility Principle (SRP)
- **Each function/class should have a single responsibility**
- A function should do only one thing, but do it well
- Separate business logic from data access
- Separate validation from processing

### 4. Pragmatism over Perfection
- **Don't separate into files until necessary**
- Keep related functions in the same file
- Split only when there's a real need (reusability, complexity, size)

---

## File Structure

### Standard Structure for Services

```
src/core/service/{service-name}/
├── {service-name}.process.ts    # Main process + helper functions
├── {service-name}.service.ts    # Reusable business logic (pure functions)
├── {service-name}.types.ts      # Shared types and interfaces
└── {service-name}.errors.ts      # Domain-specific errors
```

### When to Create Separate Files

**ALWAYS create separate files for:**
- ✅ **Shared types** (`*.types.ts`) - When types are used in multiple places
- ✅ **Specific errors** (`*.errors.ts`) - For consistent error handling
- ✅ **Reusable pure functions** (`*.service.ts`) - Business logic that can be tested in isolation

**KEEP in the same file:**
- ✅ Helper functions specific to the process
- ✅ Logic that's only used in the context of the main process
- ✅ Simple and specific validations
- ✅ Local configuration constants

**CONSIDER separating when:**
- ⚠️ Function exceeds 50-80 lines
- ⚠️ Logic is reused in other services
- ⚠️ Complexity justifies separation for readability

---

## Code Organization

### Main File Structure (`*.process.ts`)

```typescript
// 1. IMPORTS
import { ... } from "...";
import { ... } from "./{service-name}.service.ts";
import { ... } from "./{service-name}.errors.ts";
import type { ... } from "./{service-name}.types.ts";

// 2. CONSTANTS AND CONFIGURATIONS
const SERVICE_CONFIG = {
  // Configuration values
} as const;

// 3. REPOSITORIES AND DEPENDENCIES
const repository = new Repository(drizzleClient);

// 4. HELPER FUNCTIONS (logical order of use)
async function validateSomething(...) { ... }
async function processSomething(...) { ... }
function transformSomething(...) { ... }

// 5. MAIN PROCESS
export const P_ServiceName = ProcessEngine.create(
  async (input: PostEndpointInput<typeof requestSchema>) => {
    // Orchestrated main flow
  },
  { name: "ServiceNameProcessEngine" }
);
```

### Declaration Order

1. **Imports** (grouped by source)
2. **Constants and configurations**
3. **Repositories and dependencies**
4. **Helper functions** (order of use in main flow)
5. **Main process** (exported)

---

## Naming Conventions

### Files
- **Processes**: `{service-name}.process.ts` (e.g., `add-bundle.process.ts`)
- **Services**: `{service-name}.service.ts` (e.g., `bundle.service.ts`)
- **Types**: `{service-name}.types.ts` (e.g., `bundle.types.ts`)
- **Errors**: `{service-name}.errors.ts` (e.g., `bundle.errors.ts`)

### Functions
- **Validation**: `validate{Entity}` (e.g., `validateSession`, `validateBundle`)
- **Processing**: `process{Action}` (e.g., `processOperations`, `processUtxos`)
- **Transformation**: `transform{Entity}` or `{entity}To{Target}` (e.g., `transformToDto`)
- **Calculation**: `calculate{Thing}` (e.g., `calculateFee`, `calculateTotal`)
- **Persistence**: `persist{Entity}` or `save{Entity}` (e.g., `persistUtxos`)
- **Retrieval**: `get{Thing}` or `fetch{Thing}` (e.g., `getTransactionExpiration`)

### Variables
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `BUNDLE_TTL_HOURS`)
- **Configurations**: `{SERVICE}_CONFIG` (e.g., `BUNDLE_CONFIG`)
- **Types**: `PascalCase` (e.g., `ClassifiedOperations`, `FeeCalculation`)
- **Instances**: `camelCase` (e.g., `userSession`, `operationsBundle`)

### Error Classes
- **Platform errors (preferred for domain errors)**: `UPPER_SNAKE_CASE` (e.g., `INVALID_SESSION`, `BUNDLE_ALREADY_EXISTS`)
- **Error code enums**: `{SERVICE}_ERROR_CODES` (e.g., `BUNDLE_ERROR_CODES.INVALID_SESSION = "BND_001"`)
- **Source**: constant `source` describing the service context (e.g., `"@service/bundle"`)
- **Legacy/simple errors**: PascalCase `*Error` may still be used in low-level or non-HTTP contexts, but service/HTTP-facing errors should use `PlatformError`

---

## Code Patterns

### 1. Pure and Reusable Functions (`*.service.ts`)

**Characteristics:**
- Pure functions when possible (no side effects)
- Easy to test in isolation
- Reusable in different contexts
- Well documented with JSDoc

**Example:**
```typescript
/**
 * Classifies operations by type
 * 
 * @param operations - List of Moonlight operations
 * @returns Operations classified by type
 */
export function classifyOperations(
  operations: MoonlightOperation[]
): ClassifiedOperations {
  return {
    create: operations.filter((op) => op.isCreate()) as OperationTypes.CreateOperation[],
    spend: operations.filter((op) => op.isSpend()) as OperationTypes.SpendOperation[],
    deposit: operations.filter((op) => op.isDeposit()) as OperationTypes.DepositOperation[],
    withdraw: operations.filter((op) => op.isWithdraw()) as OperationTypes.WithdrawOperation[],
  };
}

/**
 * Calculates the total of a list of operations (DRY)
 * 
 * @param operations - List of operations
 * @param getAmount - Function to extract the value from each operation
 * @returns Calculated total
 */
export function calculateOperationsTotal<T extends MoonlightOperation>(
  operations: T[],
  getAmount: (op: T) => bigint
): bigint {
  return operations.reduce((acc, op) => acc + getAmount(op), BigInt(0));
}
```

### 2. Helper Functions in Process (`*.process.ts`)

**Characteristics:**
- Specific to the process context
- May have side effects (database access, external calls)
- Logically ordered (order of use)
- Descriptive names

**Example:**
```typescript
/**
 * Validates the user session
 */
async function validateSession(sessionId: string) {
  const userSession = await sessionRepository.findById(sessionId);
  if (!userSession) {
    throw new InvalidSessionError();
  }
  return userSession;
}

/**
 * Persists UTXOs in the database from create operations
 */
async function persistCreateOperations(
  operations: OperationTypes.CreateOperation[],
  bundleId: string,
  accountId: string
): Promise<void> {
  for (const operation of operations) {
    await utxoRepository.create({
      id: Buffer.from(operation.getUtxo()).toString("base64"),
      accountId,
      amount: operation.getAmount(),
      createdAt: new Date(),
      createdBy: accountId,
      createdAtBundleId: bundleId,
    });
  }
}
```

### 3. Error Handling (`*.errors.ts`)

**Pattern (service/domain errors):**
- Use `PlatformError` for domain and HTTP-facing errors
- Define a service-specific error code enum
- Define a `source` string for traceability
- Provide:
  - **code**: stable, unique error code (e.g., `BND_001`)
  - **message**: short human-readable message
  - **details**: longer technical description
  - **api**: HTTP status + client-facing message/details
  - **meta**: structured context (IDs, inputs, etc.)
  - **baseError**: underlying error (when wrapping)

**Example (`bundle.errors.ts` style):**
```typescript
import { PlatformError } from "@/error/index.ts";

export enum BUNDLE_ERROR_CODES {
  INVALID_SESSION = "BND_001",
  BUNDLE_ALREADY_EXISTS = "BND_002",
  INVALID_OPERATIONS = "BND_003",
  INSUFFICIENT_UTXOS = "BND_004",
  UTXO_NOT_FOUND = "BND_005",
  SPEND_OPERATION_NOT_SIGNED = "BND_006",
  NO_OPERATIONS_PROVIDED = "BND_007",
}

const source = "@service/bundle";

export class INVALID_SESSION extends PlatformError<{ sessionId: string }> {
  constructor(sessionId: string) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.INVALID_SESSION,
      message: "Invalid session",
      details: `The session with ID '${sessionId}' was not found or is invalid.`,
      api: {
        status: 401,
        message: "Invalid session",
        details: "The provided session is invalid or has expired. Please authenticate again.",
      },
      meta: { sessionId },
    });
  }
}

export class BUNDLE_ALREADY_EXISTS extends PlatformError<{ bundleId: string }> {
  constructor(bundleId: string) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.BUNDLE_ALREADY_EXISTS,
      message: "Bundle already exists",
      details: `A bundle with ID '${bundleId}' already exists in PENDING or COMPLETED status.`,
      api: {
        status: 409,
        message: "Bundle already exists",
        details:
          "An operations bundle with the same ID is already being processed or has already been completed. " +
          "Please wait for it to complete or use a different set of operations.",
      },
      meta: { bundleId },
    });
  }
}

export class NO_OPERATIONS_PROVIDED extends PlatformError {
  constructor() {
    super({
      source,
      code: BUNDLE_ERROR_CODES.NO_OPERATIONS_PROVIDED,
      message: "No operations provided",
      details: "The operations bundle must contain at least one operation.",
      api: {
        status: 400,
        message: "No operations provided",
        details: "The request must include at least one operation in the operations bundle.",
      },
    });
  }
}
```

**Pattern (usage in processes):**
- Import error module as a namespace: `import * as E from "./{service-name}.errors.ts";`
- Use `logAndThrow` helper to:
  - Log the error centrally
  - Throw the `PlatformError` so it propagates to the HTTP error pipeline

```typescript
import * as E from "./bundle.errors.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

async function validateSession(sessionId: string) {
  const userSession = await sessionRepository.findById(sessionId);
  if (!userSession) {
    logAndThrow(new E.INVALID_SESSION(sessionId));
  }
  return userSession;
}
```

### 4. Types and Interfaces (`*.types.ts`)

**Pattern:**
- Service domain-specific types
- Interfaces for complex data structures
- Types for unions and compositions
- Explicit export of all types

**Example:**
```typescript
export type ClassifiedOperations = {
  create: OperationTypes.CreateOperation[];
  spend: OperationTypes.SpendOperation[];
  deposit: OperationTypes.DepositOperation[];
  withdraw: OperationTypes.WithdrawOperation[];
};

export type FeeCalculation = {
  fee: bigint;
  totalInflows: bigint;
  totalOutflows: bigint;
  breakdown: {
    totalDepositAmount: bigint;
    totalCreateAmount: bigint;
    totalWithdrawAmount: bigint;
    totalSpendAmount: bigint;
  };
};
```

### 5. Main Process

**Structure:**
- Linear and readable flow
- Numbered comments for main sections
- Use of helper functions for complexity
- Appropriate error handling using `PlatformError` + `logAndThrow`
- Logging at strategic points

**Example (simplified, bundle-style):**
```typescript
export const P_AddOperationsBundle = ProcessEngine.create(
  async (input: PostEndpointInput<typeof requestSchema>) => {
    const { operationsMLXDR } = input.body;
    const sessionData = input.ctx.state.session as JwtSessionData;

    // 1. Session validation
    const userSession = await validateSession(sessionData.sessionId);

    // 2. Bundle ID generation and validation
    const bundleId = await generateBundleId(operationsMLXDR);
    const isBundleExpired = await assertBundleIsNotExpired(bundleId);

    // 3. Parse and classify operations
    const operations = await parseOperations(operationsMLXDR);
    const classified = classifyOperations(operations);
    validateSpendOperations(classified.spend);

    // 4. Bundle update or creation (idempotent-ish behaviour)
    let bundleEntity: OperationsBundle;
    if (isBundleExpired) {
      bundleEntity = await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.PENDING,
        updatedAt: new Date(),
        updatedBy: userSession.accountId,
      });
    } else {
      bundleEntity = await operationsBundleRepository.create({
        id: bundleId,
        status: BundleStatus.PENDING,
        ttl: calculateBundleTtl(),
        createdBy: userSession.accountId,
        createdAt: new Date(),
      });
    }

    // 5. Fee calculation
    const amounts = calculateOperationAmounts(classified);
    const feeCalculation = calculateFee(amounts);
    
    LOG.debug("Fee calculation breakdown", {
      totalDepositAmount: feeCalculation.breakdown.totalDepositAmount.toString(),
      // ...
    });

    // ... rest of the flow

    return {
      ctx: input.ctx,
      operationsBundleId: bundleEntity.id,
      transactionHash,
    };
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);
```

---

## Best Practices

### 1. Eliminating Code Duplication (DRY)

**❌ Avoid:**
```typescript
const totalCreateAmount = createOperations.length > 0
  ? createOperations.reduce((acc, op) => acc + op.getAmount(), BigInt(0))
  : BigInt(0);

const totalSpendAmount = spendOperations.length > 0
  ? spendOperations.reduce((acc, op) => acc + op.getAmount(), BigInt(0))
  : BigInt(0);
```

**✅ Prefer:**
```typescript
const totalCreateAmount = calculateOperationsTotal(
  createOperations,
  (op) => op.getAmount()
);

const totalSpendAmount = calculateOperationsTotal(
  spendOperations,
  (op) => op.getAmount()
);
```

### 2. Extracting Magic Values

**❌ Avoid:**
```typescript
ttl: new Date(Date.now() + 1000 * 60 * 60 * 24)
const nOfCreate = 1;
```

**✅ Prefer:**
```typescript
const BUNDLE_CONFIG = {
  TTL_HOURS: 24,
  REQUIRED_OPEX_UTXOS: 1,
} as const;

ttl: calculateBundleTtl() // or new Date(Date.now() + 1000 * 60 * 60 * BUNDLE_CONFIG.TTL_HOURS)
```

### 3. Appropriate Logging Usage

**❌ Avoid:**
```typescript
console.log("\n\n--------Operation", op.toMLXDR());
```

**✅ Prefer:**
```typescript
LOG.debug("Fee operation created", { mlxdr: feeOperation.toMLXDR() });
```

### 4. Removing Commented Code

**❌ Avoid:**
```typescript
operationsBundleId: "blabalblabla",
// operationsBundleId: newOperationsBundle.id,
```

**✅ Prefer:**
```typescript
operationsBundleId: newOperationsBundle.id,
```

### 5. Specific Error Handling

**❌ Avoid:**
```typescript
if (!userSession) {
  throw new Error("Invalid Session: Account not found in session");
}
```

**✅ Prefer:**
```typescript
import * as E from "./bundle.errors.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

if (!userSession) {
  logAndThrow(new E.INVALID_SESSION(sessionId));
}
```

### 6. Small and Focused Functions

**❌ Avoid:**
```typescript
// Function with 100+ lines doing multiple things
```

**✅ Prefer:**
```typescript
// Multiple small functions, each with a single responsibility
async function validateSession(...) { ... }
async function parseOperations(...) { ... }
async function calculateFee(...) { ... }
```

### 7. JSDoc Documentation

**✅ Always document:**
- Public/exported functions
- Complex functions
- Non-obvious parameters and returns

```typescript
/**
 * Calculates the bundle fee based on operations
 * 
 * @param breakdown - Breakdown of totals by operation type
 * @returns Complete fee calculation including breakdown
 */
export function calculateFee(breakdown: FeeCalculation["breakdown"]): FeeCalculation {
  // ...
}
```

---

## Development Checklist

When creating a new service, verify:

- [ ] File structure follows the defined pattern
- [ ] Functions follow consistent naming
- [ ] Duplicated code has been eliminated (DRY)
- [ ] Magic values have been extracted to constants
- [ ] Specific errors have been created in `*.errors.ts`
- [ ] Shared types have been defined in `*.types.ts`
- [ ] Pure functions have been extracted to `*.service.ts`
- [ ] Helper functions are in the main file when appropriate
- [ ] Main process is readable and well-structured
- [ ] Appropriate logging has been added
- [ ] Commented code has been removed
- [ ] JSDoc has been added for complex functions
- [ ] Error handling is specific and descriptive

---

## Complete Example

Refer to the `add-bundle.process.ts` service as a reference implementation following these patterns.

---

## Evolution and Maintenance

### When to Refactor

- When a function exceeds 80-100 lines
- When logic is reused in multiple places
- When complexity hinders maintenance
- When tests become difficult to write

### When NOT to Refactor

- Don't refactor "just because"
- Don't create abstractions prematurely
- Don't separate into files without real need
- Keep simplicity over "architectural perfection"

---

## References

- [Clean Code - Robert C. Martin](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- [KISS Principle](https://en.wikipedia.org/wiki/KISS_principle)
- [DRY Principle](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself)
