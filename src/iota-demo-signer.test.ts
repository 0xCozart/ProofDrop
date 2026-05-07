import assert from "node:assert/strict";
import test from "node:test";

import { createIotaDemoSigner } from "./iota-demo-signer.js";

test("IOTA demo signer returns an address and can sign bytes without exposing key material", async () => {
  const signer = await createIotaDemoSigner();
  assert.match(signer.address, /^0x[0-9a-f]{64}$/);
  const signature = await signer.signTransaction(new Uint8Array([1, 2, 3]));
  assert.equal(typeof signature, "string");
  assert.doesNotMatch(JSON.stringify(signer), /private|secret|mnemonic|seed|keypair/i);
});
