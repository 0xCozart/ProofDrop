import assert from "node:assert/strict";
import test from "node:test";

import { buildSponsoredDemoTransaction } from "./live-transaction.js";

test("buildSponsoredDemoTransaction constructs server-owned Move target and base64 bytes", async () => {
  const calls: unknown[] = [];
  const builtBytes = new Uint8Array([7, 8, 9]);

  const result = await buildSponsoredDemoTransaction(
    {
      rpcUrl: "https://rpc.example",
      packageId: "0x" + "1".repeat(64),
      moduleName: "proofdrop_badge",
      functionName: "claim_proof_badge",
      gasBudget: 50_000_000,
      senderAddress: "0x" + "2".repeat(64),
      sponsorAddress: "0x" + "3".repeat(64),
      gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
    },
    {
      createClient: (rpcUrl) => ({ rpcUrl }),
      encodeBytes: (bytes) => `encoded-${Array.from(bytes).join("-")}`,
      createTransaction: () => ({
        setSender: (value: string) => calls.push(["setSender", value]),
        setGasOwner: (value: string) => calls.push(["setGasOwner", value]),
        setGasBudget: (value: number) => calls.push(["setGasBudget", value]),
        setGasPayment: (value: unknown) => calls.push(["setGasPayment", value]),
        moveCall: (value: unknown) => calls.push(["moveCall", value]),
        build: async (value: unknown) => {
          calls.push(["build", value]);
          return builtBytes;
        },
      }),
    },
  );

  assert.equal(result.transactionBytes, "encoded-7-8-9");
  assert.deepEqual(result.rawBytes, builtBytes);
  assert.deepEqual(calls.slice(0, 5), [
    ["setSender", "0x" + "2".repeat(64)],
    ["setGasOwner", "0x" + "3".repeat(64)],
    ["setGasBudget", 50_000_000],
    ["setGasPayment", [{ objectId: "0xcoin", version: "1", digest: "digest" }]],
    ["moveCall", { target: `${"0x" + "1".repeat(64)}::proofdrop_badge::claim_proof_badge` }],
  ]);
  assert.deepEqual(calls[5], ["build", { client: { rpcUrl: "https://rpc.example" } }]);
});
