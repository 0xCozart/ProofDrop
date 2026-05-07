import assert from "node:assert/strict";
import test from "node:test";

import {
  createMockProofDropClient,
  createProofDropApi,
  createProofDropApiFromEnv,
  ProofDropAuthError,
  ProofDropUpstreamError,
  type ExecuteSponsoredTransactionRequest,
  type ExecuteSponsoredTransactionResponse,
  type PolicySimulationRequest,
  type PolicySimulationResponse,
  type ReserveGasRequest,
  type ReserveGasResponse,
} from "./api.js";
import { createDemoReservationStore } from "./demo-reservation-store.js";
import { createDemoSignerStore } from "./demo-signer.js";

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
    liveUnavailableReason: "Live testnet mode is not configured on this server.",
    packageId: "0xPROOFDROP_PACKAGE",
    moduleName: "proofdrop_badge",
    functionName: "claim_proof_badge",
  });
});

test("demo address route returns a public demo signer session only", async () => {
  const api = createProofDropApi({
    mode: "mock",
    client: createMockProofDropClient(),
    now: () => 1_000,
    demoSignerStore: createDemoSignerStore({
      now: () => 1_000,
      ttlMs: 600_000,
      generateSigner: async () => ({
        address: "0x" + "d".repeat(64),
        signTransaction: async () => "demo-signature",
      }),
    }),
  });
  const first = await api.handle(new Request("http://proofdrop.test/api/demo-address"));

  assert.equal(first.status, 200);
  const firstBody = await readJson(first) as {
    demoSessionId: string;
    address: string;
    network: string;
    ephemeral: boolean;
    signingAvailable: boolean;
    expiresInSecs: number;
  };
  assert.match(firstBody.demoSessionId, /^demo_/);
  assert.match(firstBody.address, /^0x[0-9a-f]{64}$/);
  assert.equal(firstBody.network, "iota-testnet");
  assert.equal(firstBody.ephemeral, true);
  assert.equal(firstBody.signingAvailable, true);
  assert.equal(firstBody.expiresInSecs, 600);
  assert.doesNotMatch(asText(firstBody), /private|secret|mnemonic|signature|keypair|seed/i);
});

test("demo address route rejects unsupported methods", async () => {
  const api = createProofDropApi({ mode: "mock", client: createMockProofDropClient() });
  const response = await api.handle(new Request("http://proofdrop.test/api/demo-address", { method: "POST" }));

  assert.equal(response.status, 405);
});

test("simulate validates input and rejects browser-supplied policy targets before calling GasKit", async () => {
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
  }));
  const forbiddenPackage = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    packageId: "0xATTACKER_PACKAGE",
  }));
  const forbiddenFunction = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    functionName: "evil_claim",
  }));
  const forbiddenModule = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
    moduleName: "evil_module",
  }));
  const invalidGas = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 0,
    walletAddress: "0xUSER",
  }));

  for (const response of [missingWallet, forbiddenPackage, forbiddenFunction, forbiddenModule, invalidGas]) {
    assert.equal(response.status, 400);
  }
  assert.equal((await readJson(forbiddenPackage) as { error: string }).error, "CLIENT_POLICY_TARGET_FORBIDDEN");
  assert.equal((await readJson(forbiddenFunction) as { error: string }).error, "CLIENT_POLICY_TARGET_FORBIDDEN");
  assert.equal((await readJson(forbiddenModule) as { error: string }).error, "CLIENT_POLICY_TARGET_FORBIDDEN");
  assert.equal(calls, 0);
});

test("reserve simulates policy first with the server-owned target and does not reserve after rejection", async () => {
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

test("reserve with demoSessionId uses signer address and omits gas coin internals", async () => {
  const calls: Array<{ op: string; request: PolicySimulationRequest | ReserveGasRequest }> = [];
  const demoSignerStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });
  const session = await demoSignerStore.create();
  const api = createProofDropApi({
    mode: "mock",
    client: {
      async simulatePolicy(request: PolicySimulationRequest): Promise<PolicySimulationResponse> {
        calls.push({ op: "simulate", request });
        return { allowed: true };
      },
      async reserveGas(request: ReserveGasRequest): Promise<ReserveGasResponse> {
        calls.push({ op: "reserve", request });
        return {
          reservationId: "reservation-1",
          gasKitTransactionId: "gaskit-1",
          sponsorAddress: "0x" + "b".repeat(64),
          gasCoins: [{ objectId: "0xcoin", version: "1", digest: "digest" }],
          raw: { gasCoins: "raw gas internals" },
        };
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new Error("execute should not be called");
      },
    },
    demoSignerStore,
    demoReservationStore: createDemoReservationStore({ now: () => 1_000 }),
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    demoSessionId: session.demoSessionId,
    walletAddress: "0x" + "c".repeat(64),
    gasBudget: 50_000_000,
  }));
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ op, request }) => ({ op, walletAddress: request.walletAddress })), [
    { op: "simulate", walletAddress: "0x" + "a".repeat(64) },
    { op: "reserve", walletAddress: "0x" + "a".repeat(64) },
  ]);
  assert.doesNotMatch(asText(body), /gasCoins|raw gas|0xcoin|digest/i);
});

test("reserve with missing demoSessionId fails closed before calling GasKit", async () => {
  let calls = 0;
  const api = createProofDropApi({
    mode: "mock",
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        calls += 1;
        return { allowed: true };
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        calls += 1;
        return { reservationId: "reservation-1", gasKitTransactionId: "gaskit-1" };
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new Error("execute should not be called");
      },
    },
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    demoSessionId: "demo_missing_session",
    walletAddress: "0x" + "c".repeat(64),
  }));

  assert.equal(response.status, 400);
  assert.equal((await readJson(response) as { error: string }).error, "DEMO_SIGNER_EXPIRED");
  assert.equal(calls, 0);
});

test("reserve with demoSessionId fails closed if GasKit omits demo gas internals", async () => {
  const demoSignerStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "server-demo-signature",
    }),
  });
  const session = await demoSignerStore.create();
  const api = createProofDropApi({
    mode: "mock",
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        return { allowed: true };
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        return {
          reservationId: "reservation-1",
          gasKitTransactionId: "gaskit-1",
          sponsorAddress: "0x" + "b".repeat(64),
        };
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new Error("execute should not be called");
      },
    },
    demoSignerStore,
    demoReservationStore: createDemoReservationStore({ now: () => 1_000 }),
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    demoSessionId: session.demoSessionId,
    walletAddress: session.address,
  }));
  const body = await readJson(response);

  assert.equal(response.status, 502);
  assert.deepEqual(body, {
    error: "GASKIT_REQUEST_FAILED",
    message: "Sponsorship service did not return a usable demo gas reservation.",
    mode: "mock",
  });
  assert.doesNotMatch(asText(body), /gasCoins|0xcoin|raw|signature|transactionBytes/i);
});

test("concurrent demo execute attempts return a bounded 409", async () => {
  const demoSignerStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "server-demo-signature",
    }),
  });
  const demoReservationStore = createDemoReservationStore({ now: () => 1_000 });
  const session = await demoSignerStore.create();
  demoReservationStore.put({
    demoSessionId: session.demoSessionId,
    walletAddress: session.address,
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    sponsorAddress: "0x" + "b".repeat(64),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });
  assert.ok(demoReservationStore.beginExecute({
    demoSessionId: session.demoSessionId,
    walletAddress: session.address,
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
  }));
  const api = createProofDropApi({
    mode: "mock",
    client: createMockProofDropClient(),
    demoSignerStore,
    demoReservationStore,
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/demo-execute", {
    demoSessionId: session.demoSessionId,
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await readJson(response), {
    error: "DEMO_EXECUTE_IN_PROGRESS",
    message: "This demo reservation is already executing.",
  });
});

test("demo execute path consumes signer and calls execute with internally signed payload", async () => {
  const executeCalls: ExecuteSponsoredTransactionRequest[] = [];
  const demoSignerStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "server-demo-signature",
    }),
  });
  const demoReservationStore = createDemoReservationStore({ now: () => 1_000 });
  const session = await demoSignerStore.create();
  const api = createProofDropApi({
    mode: "mock",
    explorerBaseUrl: "https://explorer.iota.org/txblock/{digest}?network=testnet",
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        return { allowed: true };
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        return {
          reservationId: "reservation-1",
          gasKitTransactionId: "gaskit-1",
          sponsorAddress: "0x" + "b".repeat(64),
          gasCoins: [{ objectId: "0xcoin", version: "1", digest: "digest" }],
        };
      },
      async executeSponsoredTransaction(request: ExecuteSponsoredTransactionRequest): Promise<ExecuteSponsoredTransactionResponse> {
        executeCalls.push(request);
        return { digest: "0xPROOFDROP_DIGEST", raw: { transactionBytes: "raw", userSignature: "raw" } };
      },
    },
    demoSignerStore,
    demoReservationStore,
  });

  const reserve = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    demoSessionId: session.demoSessionId,
    walletAddress: "0x" + "a".repeat(64),
  }));
  assert.equal(reserve.status, 200);
  const reservation = await readJson(reserve) as { reservationId: string; gasKitTransactionId: string };

  const mismatch = await api.handle(jsonRequest("/api/sponsorship/demo-execute", {
    demoSessionId: "demo_mismatched_session",
    reservationId: reservation.reservationId,
    gasKitTransactionId: reservation.gasKitTransactionId,
  }));
  assert.equal(mismatch.status, 400);

  const response = await api.handle(jsonRequest("/api/sponsorship/demo-execute", {
    demoSessionId: session.demoSessionId,
    reservationId: reservation.reservationId,
    gasKitTransactionId: reservation.gasKitTransactionId,
  }));
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(executeCalls, [
    {
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
      transactionBytes: "mock-proofdrop-transaction-bytes",
      userSignature: "server-demo-signature",
    },
  ]);
  assert.deepEqual(body, {
    sponsored: true,
    digest: "0xPROOFDROP_DIGEST",
    explorerUrl: "https://explorer.iota.org/txblock/0xPROOFDROP_DIGEST?network=testnet",
    mode: "mock",
  });
  assert.equal(demoSignerStore.get(session.demoSessionId), undefined);
  assert.doesNotMatch(asText(body), /transactionBytes|userSignature|server-demo-signature|0xcoin|raw/i);
});

test("live demo execute is disabled unless explicitly enabled", async () => {
  const demoSignerStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "server-demo-signature",
    }),
  });
  const session = await demoSignerStore.create();
  const demoReservationStore = createDemoReservationStore({ now: () => 1_000 });
  demoReservationStore.put({
    demoSessionId: session.demoSessionId,
    walletAddress: session.address,
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    sponsorAddress: "0x" + "b".repeat(64),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });
  const api = createProofDropApi({
    mode: "live",
    liveAvailable: true,
    client: createMockProofDropClient(),
    demoSignerStore,
    demoReservationStore,
    demoSignerLiveExecutionEnabled: false,
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/demo-execute", {
    demoSessionId: session.demoSessionId,
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
  }));

  assert.equal(response.status, 503);
  assert.equal((await readJson(response) as { error: string }).error, "DEMO_SIGNER_UNAVAILABLE");
});

test("live demo execute builds transaction bytes internally and omits signed payload", async () => {
  const executeCalls: ExecuteSponsoredTransactionRequest[] = [];
  const buildCalls: unknown[] = [];
  const demoSignerStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async (bytes: Uint8Array) => `server-signature-${Array.from(bytes).join("-")}`,
    }),
  });
  const demoReservationStore = createDemoReservationStore({ now: () => 1_000 });
  const session = await demoSignerStore.create();
  const api = createProofDropApi({
    mode: "live",
    liveAvailable: true,
    demoSignerLiveExecutionEnabled: true,
    iotaRpcUrl: "https://rpc.example",
    packageId: "0x" + "1".repeat(64),
    moduleName: "proofdrop_badge",
    functionName: "claim_proof_badge",
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        return { allowed: true };
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        return {
          reservationId: "reservation-1",
          gasKitTransactionId: "gaskit-1",
          sponsorAddress: "0x" + "b".repeat(64),
          gasCoins: [{ objectId: "0xcoin", version: "1", digest: "digest" }],
        };
      },
      async executeSponsoredTransaction(request: ExecuteSponsoredTransactionRequest): Promise<ExecuteSponsoredTransactionResponse> {
        executeCalls.push(request);
        return { digest: "0xLIVE_DIGEST", raw: { transactionBytes: request.transactionBytes, userSignature: request.userSignature } };
      },
    },
    buildSponsoredDemoTransaction: async (input) => {
      buildCalls.push(input);
      return { transactionBytes: "built-live-transaction-bytes", rawBytes: new Uint8Array([9, 9]) };
    },
    demoSignerStore,
    demoReservationStore,
    explorerBaseUrl: "https://explorer.iota.org/txblock/{digest}?network=testnet",
  });

  const reserve = await api.handle(jsonRequest("/api/sponsorship/reserve", {
    demoSessionId: session.demoSessionId,
    walletAddress: session.address,
  }));
  assert.equal(reserve.status, 200);
  const reservation = await readJson(reserve) as { reservationId: string; gasKitTransactionId: string };
  const response = await api.handle(jsonRequest("/api/sponsorship/demo-execute", {
    demoSessionId: session.demoSessionId,
    reservationId: reservation.reservationId,
    gasKitTransactionId: reservation.gasKitTransactionId,
  }));
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(buildCalls, [{
    rpcUrl: "https://rpc.example",
    packageId: "0x" + "1".repeat(64),
    moduleName: "proofdrop_badge",
    functionName: "claim_proof_badge",
    gasBudget: 50_000_000,
    senderAddress: session.address,
    sponsorAddress: "0x" + "b".repeat(64),
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  }]);
  assert.deepEqual(executeCalls, [{
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    transactionBytes: "built-live-transaction-bytes",
    userSignature: "server-signature-9-9",
  }]);
  assert.deepEqual(body, {
    sponsored: true,
    digest: "0xLIVE_DIGEST",
    explorerUrl: "https://explorer.iota.org/txblock/0xLIVE_DIGEST?network=testnet",
    mode: "live",
  });
  assert.doesNotMatch(asText(body), /built-live|server-signature|transactionBytes|userSignature|0xcoin|raw/i);
});

test("execute validates signature payload and returns only a safe digest result", async () => {
  const executeCalls: ExecuteSponsoredTransactionRequest[] = [];
  const api = createProofDropApi({
    mode: "mock",
    explorerBaseUrl: "https://explorer.iota.org/txblock/{digest}?network=testnet",
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
    explorerUrl: "https://explorer.iota.org/txblock/0xPROOFDROP_DIGEST?network=testnet",
    mode: "mock",
  });
  assert.doesNotMatch(asText(body), /raw-transaction|raw-user|mock-tx-bytes|mock-user-signature|credential/i);
});

test("auth and upstream errors map to bounded public responses without raw bodies", async () => {
  const api = createProofDropApi({
    mode: "live",
    liveAvailable: true,
    client: {
      async simulatePolicy(): Promise<PolicySimulationResponse> {
        throw new ProofDropAuthError("raw auth body leaked", 401);
      },
      async reserveGas(): Promise<ReserveGasResponse> {
        throw new Error("reserve should not be called");
      },
      async executeSponsoredTransaction(): Promise<ExecuteSponsoredTransactionResponse> {
        throw new ProofDropUpstreamError("raw upstream body leaked", 502);
      },
    },
  });

  const simulate = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
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
  }));

  assert.equal(response.status, 503);
  assert.deepEqual(await readJson(response), {
    error: "LIVE_TESTNET_UNAVAILABLE",
    message: "Live testnet mode is not configured on this server.",
    mode: "live",
  });
});

test("live mode fails closed when configured SDK module is unavailable", async () => {
  const api = createProofDropApiFromEnv({
    PROOFDROP_MODE: "live",
    GASKIT_GATEWAY_URL: "https://gaskit.example",
    GASKIT_PROOFDROP_APP_KEY: "example-live-app-key-value",
    GASKIT_SDK_MODULE: "proofdrop-missing-gaskit-sdk-module",
  });

  const response = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
  }));

  assert.equal(response.status, 503);
  assert.deepEqual(await readJson(response), {
    error: "LIVE_TESTNET_UNAVAILABLE",
    message: "Live GasKit SDK module is unavailable.",
    mode: "live",
  });
});

test("health reports live unavailable when configured SDK module cannot load", async () => {
  const api = createProofDropApiFromEnv({
    PROOFDROP_MODE: "live",
    GASKIT_GATEWAY_URL: "https://gaskit.example",
    GASKIT_PROOFDROP_APP_KEY: "example-live-app-key-value",
    GASKIT_SDK_MODULE: "proofdrop-missing-gaskit-sdk-module",
  });

  const response = await api.handle(new Request("http://proofdrop.test/api/health"));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    ok: true,
    app: "Gasless ProofDrop",
    mode: "live",
    liveAvailable: false,
    liveUnavailableReason: "Live GasKit SDK module is unavailable.",
    packageId: "0xPROOFDROP_PACKAGE",
    moduleName: "proofdrop_badge",
    functionName: "claim_proof_badge",
  });
});

test("mock mode proves simulate to reserve to execute without live IOTA services", async () => {
  const api = createProofDropApi({
    mode: "mock",
    client: createMockProofDropClient(),
    explorerBaseUrl: "https://explorer.iota.org/txblock/{digest}?network=testnet",
  });

  const simulate = await api.handle(jsonRequest("/api/sponsorship/simulate", {
    gasBudget: 50_000_000,
    walletAddress: "0xUSER",
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
    explorerUrl: "https://explorer.iota.org/txblock/0xMOCK_PROOFDROP_DIGEST?network=testnet",
    mode: "mock",
  });
});
