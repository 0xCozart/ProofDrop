import assert from "node:assert/strict";
import test from "node:test";

import { createDemoSignerStore } from "./demo-signer.js";

test("demo signer store creates a public session without exposing signing material", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const session = await store.create();

  assert.match(session.demoSessionId, /^demo_[A-Za-z0-9_-]+$/);
  assert.equal(session.address, "0x" + "a".repeat(64));
  assert.equal(session.expiresAt, 601_000);
  assert.doesNotMatch(JSON.stringify(session), /sign|key|secret|mnemonic|seed/i);
});

test("demo signer store resolves active sessions and expires old sessions", async () => {
  let now = 1_000;
  const store = createDemoSignerStore({
    now: () => now,
    ttlMs: 10,
    generateSigner: async () => ({
      address: "0x" + "b".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const session = await store.create();
  assert.ok(store.get(session.demoSessionId));
  now = 1_011;
  assert.equal(store.get(session.demoSessionId), undefined);
});

test("demo signer store can mark a session used after successful execute", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "e".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const session = await store.create();
  assert.ok(store.get(session.demoSessionId));
  store.markUsed(session.demoSessionId);
  assert.equal(store.get(session.demoSessionId), undefined);
});

test("demo signer store enforces active session caps", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    maxSessions: 1,
    generateSigner: async () => ({
      address: "0x" + "d".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const first = await store.create();
  const second = await store.create();
  assert.equal(store.get(first.demoSessionId), undefined);
  assert.ok(store.get(second.demoSessionId));
});

test("demo signer store enforces daily create and execute caps", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    maxCreatesPerDay: 1,
    maxExecutesPerDay: 1,
    generateSigner: async () => ({
      address: "0x" + "f".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const first = await store.create();
  await assert.rejects(() => store.create(), /DEMO_SIGNER_CREATE_LIMIT_EXCEEDED/);
  store.claimExecutePermit();
  store.markUsed(first.demoSessionId);
  const secondStore = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    maxExecutesPerDay: 0,
    generateSigner: async () => ({
      address: "0x" + "f".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });
  await secondStore.create();
  assert.throws(() => secondStore.claimExecutePermit(), /DEMO_SIGNER_EXECUTE_LIMIT_EXCEEDED/);
});

test("demo signer store does not spend create quota when signer generation fails", async () => {
  let attempts = 0;
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    maxCreatesPerDay: 1,
    generateSigner: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary signer failure");
      return {
        address: "0x" + "f".repeat(64),
        signTransaction: async () => "demo-signature",
      };
    },
  });

  await assert.rejects(() => store.create(), /temporary signer failure/);
  const session = await store.create();
  assert.match(session.demoSessionId, /^demo_/);
});

test("demo signer store releases an execute permit when retry is safe", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    maxExecutesPerDay: 1,
    generateSigner: async () => ({
      address: "0x" + "f".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  await store.create();
  const release = store.claimExecutePermit();
  assert.throws(() => store.claimExecutePermit(), /DEMO_SIGNER_EXECUTE_LIMIT_EXCEEDED/);
  release();
  assert.doesNotThrow(() => store.claimExecutePermit());
});
