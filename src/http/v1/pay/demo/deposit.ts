import { type Context, Status } from "@oak/oak";
import { Buffer } from "buffer";
import { Keypair } from "stellar-sdk";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import type { Ed25519PublicKey, ContractId } from "@colibri/core";
import {
  OPEX_SK,
  CHANNEL_CONTRACT_ID,
  CHANNEL_ASSET,
  NETWORK_CONFIG,
  NETWORK_RPC_SERVER,
} from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

/**
 * POST /pay/demo/deposit
 *
 * Demo-only endpoint: deposits XLM into a UTXO using the PP's treasury (OpEx) account.
 * This is for testing and demo purposes — production deposits would come from
 * the user's own Stellar account.
 *
 * Body: { publicKey: string, amount: string }
 *   - publicKey: hex-encoded P256 UTXO public key
 *   - amount: amount in stroops (as string)
 *
 * Response: { bundleId: string, status: string }
 */
export const postDemoDepositHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { publicKey, amount } = body;

    if (!publicKey || !amount) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "publicKey and amount are required" };
      return;
    }

    const depositAmount = BigInt(amount);
    if (depositAmount <= 0n) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "amount must be positive" };
      return;
    }

    // Convert hex public key to Uint8Array for the UTXO
    const utxoPublicKey = new Uint8Array(Buffer.from(publicKey, "hex"));

    // Build CREATE operation for the UTXO
    const createOp = MoonlightOperation.create(utxoPublicKey, depositAmount);

    // Build DEPOSIT operation from the PP's treasury account
    const opexKeypair = Keypair.fromSecret(OPEX_SK);

    // Get current ledger for signature expiration
    const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
    const expirationLedger = latestLedger.sequence + 1000;

    // Deposit amount must exceed the CREATE amount so the provider earns a fee.
    // Add 0.05 XLM (500000 stroops) fee margin, matching the E2E LOW entropy fee.
    const FEE_MARGIN = 500000n;
    const depositTotal = depositAmount + FEE_MARGIN;

    const depositOp = await MoonlightOperation.deposit(
      opexKeypair.publicKey() as Ed25519PublicKey,
      depositTotal,
    )
      .addConditions([createOp.toCondition()])
      .signWithEd25519(
        opexKeypair,
        expirationLedger,
        CHANNEL_CONTRACT_ID as ContractId,
        CHANNEL_ASSET.contractId as ContractId,
        NETWORK_CONFIG.networkPassphrase,
      );

    // Serialize to MLXDR for the bundle pipeline
    const operationsMLXDR = [depositOp.toMLXDR(), createOp.toMLXDR()];

    LOG.info("Demo deposit operations built", {
      publicKey,
      amount: depositAmount.toString(),
      operationCount: operationsMLXDR.length,
    });

    // Submit to the bundle endpoint internally by forwarding the request
    // We reuse the existing bundle pipeline by making an internal fetch
    const bundleUrl = `${ctx.request.url.origin}/api/v1/bundle`;
    const authorization = ctx.request.headers.get("authorization");

    const bundleResponse = await fetch(bundleUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ operationsMLXDR }),
    });

    const bundleResult = await bundleResponse.json();

    if (!bundleResponse.ok) {
      LOG.warn("Demo deposit bundle submission failed", {
        status: bundleResponse.status,
        result: bundleResult,
      });
      ctx.response.status = bundleResponse.status as Status;
      ctx.response.body = {
        message: "Demo deposit failed",
        data: bundleResult,
      };
      return;
    }

    LOG.info("Demo deposit submitted to bundle pipeline", {
      publicKey,
      amount: depositAmount.toString(),
      bundleId: bundleResult.data?.operationsBundleId,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Demo deposit submitted",
      data: {
        bundleId: bundleResult.data?.operationsBundleId ?? "unknown",
        status: "PENDING",
      },
    };
  } catch (error) {
    LOG.warn("Demo deposit failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
