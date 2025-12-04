import type { Transaction, OperationType } from "stellar-sdk";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import * as E from "@/core/service/auth/challenge/error.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";

export function extractOperationFromChallengeTx(tx: Transaction): {
  nonce: string;
  clientAccount: string;
} {
  assertOrThrow(tx.operations.length > 0, new E.MISSING_NONCE_OPERATION(tx));

  const operation = tx.operations[0];

  const expectedOperationType = "manageData" as OperationType.ManageData;
  assertOrThrow(
    operation.type === expectedOperationType,
    new E.WRONG_OPERATION_TYPE(expectedOperationType, operation.type)
  );

  const clientAccount = operation.source;

  assertOrThrow(isDefined(clientAccount), new E.MISSING_CLIENT_ACCOUNT());

  const nonce = operation.value?.toString();
  assertOrThrow(isDefined(nonce), new E.MISSING_NONCE());
  return { nonce, clientAccount };
}
