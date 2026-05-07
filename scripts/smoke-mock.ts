import assert from "node:assert/strict";

import { createProofDropApiFromEnv } from "../src/api.js";

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://proofdrop.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function text(value: unknown): string {
  return JSON.stringify(value);
}

const api = createProofDropApiFromEnv({
  PROOFDROP_MODE: "mock",
});

const health = await api.handle(new Request("http://proofdrop.local/api/health"));
assert.equal(health.status, 200);
assert.equal((await readJson(health) as { mode: string }).mode, "mock");

const demoAddress = await api.handle(new Request("http://proofdrop.local/api/demo-address"));
assert.equal(demoAddress.status, 200);
const demoAddressBody = await readJson(demoAddress) as {
  demoSessionId: string;
  address: string;
  ephemeral: boolean;
  signingAvailable: boolean;
};
assert.match(demoAddressBody.demoSessionId, /^demo_/);
assert.match(demoAddressBody.address, /^0x[0-9a-f]{64}$/);
assert.equal(demoAddressBody.ephemeral, true);
assert.equal(demoAddressBody.signingAvailable, true);

const simulate = await api.handle(jsonRequest("/api/sponsorship/simulate", {
  demoSessionId: demoAddressBody.demoSessionId,
  walletAddress: demoAddressBody.address,
}));
assert.equal(simulate.status, 200);
assert.deepEqual(await readJson(simulate), {
  sponsored: true,
  decision: { allowed: true },
  mode: "mock",
});

const reserve = await api.handle(jsonRequest("/api/sponsorship/reserve", {
  demoSessionId: demoAddressBody.demoSessionId,
  walletAddress: demoAddressBody.address,
}));
assert.equal(reserve.status, 200);
const reservation = await readJson(reserve) as {
  sponsored: boolean;
  reservationId: string;
  gasKitTransactionId: string;
  mode: string;
};
assert.equal(reservation.sponsored, true);
assert.equal(reservation.reservationId, "proofdrop-mock-reservation-1");
assert.equal(reservation.gasKitTransactionId, "proofdrop-mock-tx-1");
assert.equal(reservation.mode, "mock");

const execute = await api.handle(jsonRequest("/api/sponsorship/demo-execute", {
  demoSessionId: demoAddressBody.demoSessionId,
  reservationId: reservation.reservationId,
  gasKitTransactionId: reservation.gasKitTransactionId,
}));
assert.equal(execute.status, 200);
const executed = await readJson(execute);
assert.deepEqual(executed, {
  sponsored: true,
  digest: "0xMOCK_PROOFDROP_DIGEST",
  explorerUrl: "https://explorer.iota.org/txblock/0xMOCK_PROOFDROP_DIGEST?network=testnet",
  mode: "mock",
});
assert.doesNotMatch(text(executed), /GASKIT_PROOFDROP_APP_KEY|GAS_STATION_BEARER_TOKEN|transactionBytes|userSignature|raw|credential/i);

console.log("ProofDrop mock smoke passed: simulate -> reserve -> execute returned 0xMOCK_PROOFDROP_DIGEST.");
