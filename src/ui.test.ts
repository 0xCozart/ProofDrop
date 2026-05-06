import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("frontend includes the required ProofDrop claim states and sections", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = `${html}\n${app}`;

  for (const required of [
    "Gasless ProofDrop",
    "Claim an IOTA testnet proof badge without holding IOTA. You sign; GasKit sponsors the gas.",
    "wallet-not-connected",
    "wallet-connected",
    "checking-sponsorship-policy",
    "policy-rejected",
    "gas-reserved",
    "waiting-for-user-signature",
    "executing-sponsored-transaction",
    "success-with-digest",
    "failed-safe-error",
    "live-testnet-unavailable",
    "mock-local-mode-active",
    "How it works",
    "Safety",
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
