import assert from "node:assert/strict";
import test from "node:test";

import { createDemoReservationStore } from "./demo-reservation-store.js";

function address(char: string): string {
  return "0x" + char.repeat(64);
}

test("reservation binding rejects mismatched session or wallet and is one-use", () => {
  const store = createDemoReservationStore({ now: () => 1_000, ttlMs: 120_000 });
  store.put({
    demoSessionId: "demo_a",
    walletAddress: address("a"),
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    sponsorAddress: address("b"),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });

  assert.equal(
    store.beginExecute({
      demoSessionId: "demo_b",
      walletAddress: address("a"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
    undefined,
  );
  assert.equal(
    store.beginExecute({
      demoSessionId: "demo_a",
      walletAddress: address("c"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
    undefined,
  );
  const binding = store.beginExecute({
    demoSessionId: "demo_a",
    walletAddress: address("a"),
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
  });
  assert.ok(binding);
  assert.equal(
    store.beginExecute({
      demoSessionId: "demo_a",
      walletAddress: address("a"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
    undefined,
  );
  store.markExecuted(binding.gasKitTransactionId);
  assert.equal(
    store.beginExecute({
      demoSessionId: "demo_a",
      walletAddress: address("a"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
    undefined,
  );
});

test("reservation binding can release in-flight execute when retry is safe", () => {
  const store = createDemoReservationStore({ now: () => 1_000, ttlMs: 120_000 });
  store.put({
    demoSessionId: "demo_a",
    walletAddress: address("a"),
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    sponsorAddress: address("b"),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });

  assert.ok(
    store.beginExecute({
      demoSessionId: "demo_a",
      walletAddress: address("a"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
  );
  store.releaseExecute("gaskit-1");
  assert.ok(
    store.beginExecute({
      demoSessionId: "demo_a",
      walletAddress: address("a"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
  );
});

test("reservation binding reports in-flight state separately from missing bindings", () => {
  const store = createDemoReservationStore({ now: () => 1_000, ttlMs: 120_000 });
  const lookup = {
    demoSessionId: "demo_a",
    walletAddress: address("a"),
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
  };
  store.put({
    ...lookup,
    sponsorAddress: address("b"),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });

  assert.equal(store.executeState(lookup), "ready");
  assert.ok(store.beginExecute(lookup));
  assert.equal(store.executeState(lookup), "in-flight");
  assert.equal(store.executeState({ ...lookup, demoSessionId: "demo_other" }), "not-found");
});

test("reservation binding expires old entries", () => {
  let now = 1_000;
  const store = createDemoReservationStore({ now: () => now, ttlMs: 10 });
  store.put({
    demoSessionId: "demo_a",
    walletAddress: address("a"),
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    sponsorAddress: address("b"),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });

  now = 1_011;
  assert.equal(
    store.beginExecute({
      demoSessionId: "demo_a",
      walletAddress: address("a"),
      reservationId: "reservation-1",
      gasKitTransactionId: "gaskit-1",
    }),
    undefined,
  );
});
