import assert from "node:assert/strict";
import test from "node:test";

import { GasKitAuthError, GasKitError, GasKitPolicyError } from "@iota-gaskit/sdk";
import type {
  ExecuteSponsoredTransactionRequest,
  ExecuteSponsoredTransactionResponse,
  PolicySimulationRequest,
  PolicySimulationResponse,
  ReserveGasRequest,
  ReserveGasResponse,
} from "@iota-gaskit/sdk";

import { createMockProofDropClient, createProofDropApi } from "./api.js";

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return new Request(`http://proofdrop.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asText(value: unknown): string {
  return JSON.stringify(value);
}

test("health reports mock mode by default without requiring live sponsor credentials", async () => {
  const api = createProofDropApi({ mode: "mock", client: createMockProofDropClient() });
  const response = await api.handle(new Request("http://proofdrop.test/api/health"));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    ok: true,
    app: "Gasless ProofDrop",
    mode: "mock",
    liveAvailable: false,
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  });
});

test("simulate route validates required sponsorship fields before calling GasKit", async () => {
  let calls = 0;
  const api = createProofDropApi({
    mode: "mock",
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        calls += 1;
        return { allowed: true };
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        throw new Error("reserve should not be called");
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new Error("execute should not be called");
      },
    },
  });

  const missingWallet = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  }));
  const missingPackage = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    functionName: "claim_proof_badge",
  }));
  const missingFunction = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    packageId: "0xPROOFDROP_PACKAGE",
  }));
  const invalidGas = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 0,
    walletAddress: "0xUSER",
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  }));

  for (const response of [missingWallet, missingPackage, missingFunction, invalidGas]) {
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test("reserve route simulates policy first and returns safe rejection data without reserving gas", async () => {
  const calls: Array<{ op: string; request: PolicySimulationRequest | ReserveGasRequest }> = [];
  const api = createProofDropApi({
    mode: "mock",
    client: {
      async simulatePolicy(request: PolicySimulationRequest): Promise<PolicySimulationResponse> {
        calls.push({ op: "simulate", request });
        return {
          allowed: false,
          reasonCode: "WALLET_DENIED",
          message: "Wallet is denied by ProofDrop policy.",
        };
      },
      async reserveGas(request: ReserveGasRequest): Promise<ReserveGasResponse> {
        calls.push({ op: "reserve", request });
        throw new Error("reserve should not be called");
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new Error("execute should not be called");
      },
    },
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    walletAddress: "0xDENIED_PROOFDROP_WALLET",
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
    gasBudget: 50_000_000,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      op: "simulate",
      request: {
        walletAddress: "0xDENIED_PROOFDROP_WALLET",
        packageId: "0xPROOFDROP_PACKAGE",
        functionName: "claim_proof_badge",
        gasBudget: 50_000_000,
      },
    },
  ]);
  assert.deepEqual(await readJson(response), {
    sponsored: false,
    decision: {
      allowed: false,
      reasonCode: "WALLET_DENIED",
      message: "Wallet is denied by ProofDrop policy.",
    },
    mode: "mock",
  });
});

test("execute route validates signature payload and returns only a safe digest result", async () => {
  const executeCalls: ExecuteSponsoredTransactionRequest[] = [];
  const api = createProofDropApi({
    mode: "mock",
    explorerBaseUrl: "https://explorer.iota.org/txblock",
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        throw new Error("simulate should not be called");
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        throw new Error("reserve should not be called");
      },
      async executeSponsoredTransaction(
        request: ExecuteSponsoredTransactionRequest,
      ): Promise<ExecuteSponsoredTransactionResponse> {
        executeCalls.push(request);
        return {
          digest: "0xPROOFDROP_DIGEST",
          raw: {
            transactionBytes: "raw-transaction-bytes",
            userSignature: "raw-user-signature",
            bearerCredential: "redacted-upstream-credential",
          },
        };
      },
    },
  });

  const invalid = await api.handle(jsonRequest("/api/sponsorship/execute", {
    reservationId: "",
    gasKitTransactionId: "gaskit-1",
    transactionBytes: "mock-tx-bytes",
    userSignature: "mock-user-signature",
  }));
  assert.equal(invalid.status, 400);

  const response = await api.handle(jsonRequest("/api/sponsorship/execute", {
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    transactionBytes: "mock-tx-bytes",
    userSignature: "mock-user-signature",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(executeCalls, [
    {
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
      transactionBytes: "mock-tx-bytes",
      userSignature: "mock-user-signature",
    },
  ]);
  const body = await readJson(response);
  assert.deepEqual(body, {
    sponsored: true,
    digest: "0xPROOFDROP_DIGEST",
    explorerUrl: "https://explorer.iota.org/txblock/0xPROOFDROP_DIGEST",
    mode: "mock",
  });
  assert.doesNotMatch(asText(body), /raw-transaction|raw-user|mock-tx-bytes|mock-user-signature|credential/i);
});

test("SDK auth and upstream errors map to bounded public responses without raw bodies", async () => {
  const api = createProofDropApi({
    mode: "live",
    liveAvailable: true,
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        throw new GasKitAuthError("raw auth body leaked", 401, {
          appCredential: "redacted-app-credential",
          upstreamCredential: "redacted-upstream-credential",
        });
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        throw new Error("reserve should not be called");
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new GasKitError("raw upstream body leaked", 502, {
          rawBody: "official gas station raw body",
          userSignature: "signed-by-user",
        });
      },
    },
  });

  const simulate = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  }));
  const execute = await api.handle(jsonRequest("/api/sponsorship/execute", {
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    transactionBytes: "mock-tx-bytes",
    userSignature: "mock-user-signature",
  }));

  assert.equal(simulate.status, 401);
  assert.equal(execute.status, 502);
  const bodies = [await readJson(simulate), await readJson(execute)];
  assert.deepEqual(bodies, [
    {
      error: "AUTH_FAILED",
      message: "Sponsorship service authentication failed.",
      mode: "live",
    },
    {
      error: "GASKIT_REQUEST_FAILED",
      message: "Sponsorship service is unavailable.",
      mode: "live",
    },
  ]);
  assert.doesNotMatch(asText(bodies), /credential|raw auth|raw upstream|gas station raw|signature|tx-bytes/i);
});

test("live mode fails closed when live credentials are not configured", async () => {
  const api = createProofDropApi({
    mode: "live",
    liveAvailable: false,
    liveUnavailableReason: "Live testnet mode is not configured on this server.",
    client: createMockProofDropClient(),
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  }));

  assert.equal(response.status, 503);
  assert.deepEqual(await readJson(response), {
    error: "LIVE_TESTNET_UNAVAILABLE",
    message: "Live testnet mode is not configured on this server.",
    mode: "live",
  });
});

test("mock mode proves simulate to reserve to execute without live IOTA services", async () => {
  const api = createProofDropApi({
    mode: "mock",
    client: createMockProofDropClient(),
    explorerBaseUrl: "https://explorer.iota.org/txblock",
  });

  const simulate = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  }));
  assert.equal(simulate.status, 200);
  assert.deepEqual(await readJson(simulate), {
    sponsored: true,
    decision: { allowed: true },
    mode: "mock",
  });

  const reserve = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    packageId: "0xPROOFDROP_PACKAGE",
    functionName: "claim_proof_badge",
  }));
  assert.equal(reserve.status, 200);
  assert.deepEqual(await readJson(reserve), {
    sponsored: true,
    reservationId: "proofdrop-mock-reservation-1",
    gasKitTransactionId: "proofdrop-mock-tx-1",
    sponsorAddress: "0xMOCK_PROOFDROP_SPONSOR",
    expiresInSecs: 30,
    mode: "mock",
  });

  const execute = await api.handle(jsonRequest("/api/sponsorship/execute", {
    reservationId: "proofdrop-mock-reservation-1",
    gasKitTransactionId: "proofdrop-mock-tx-1",
    transactionBytes: "mock-proofdrop-transaction-bytes",
    userSignature: "mock-proofdrop-user-signature",
  }));
  assert.equal(execute.status, 200);
  assert.deepEqual(await readJson(execute), {
    sponsored: true,
    digest: "0xMOCK_PROOFDROP_DIGEST",
    explorerUrl: "https://explorer.iota.org/txblock/0xMOCK_PROOFDROP_DIGEST",
    mode: "mock",
  });
});
