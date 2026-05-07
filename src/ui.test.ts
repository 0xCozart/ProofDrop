import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("frontend includes the required ProofDrop claim states and sections", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = `${html}\n${app}`;

  for (const required of [
    "Gasless ProofDrop",
    "Preview a gasless IOTA proof badge claim. The demo can generate a server-side ephemeral testnet signer; real browser wallet signing is a future milestone.",
    "Generate demo signer",
    "No wallet connected",
    "Ephemeral server-side demo signer ready",
    "No browser wallet is connected. Server signs only this demo transaction if live mode is configured.",
    "/api/sponsorship/demo-execute",
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

test("frontend copy does not imply the mock address is a real wallet connection", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = `${html}\n${app}`;

  for (const forbidden of [
    "Connect mock wallet",
    "Wallet connected:",
    "Ready to check ProofDrop sponsorship policy.",
    "You sign; GasKit sponsors the gas.",
    "0xPROOFDROP_VISITOR",
    "testnet-format only",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("frontend does not expose server credential names or send policy target overrides", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const source = `${html}\n${app}`;

  for (const forbidden of [
    "GASKIT_PROOFDROP_APP_KEY",
    "GAS_STATION_BEARER_TOKEN",
    "sponsor key",
    "private key",
    "mnemonic",
    "packageId:",
    "moduleName:",
    "functionName:",
    "GASKIT_PROOFDROP_APP_KEY",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});
