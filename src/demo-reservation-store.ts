export interface DemoGasCoin {
  objectId: string;
  version: string | number;
  digest: string;
}

export interface DemoReservationBinding {
  demoSessionId: string;
  walletAddress: string;
  reservationId: string;
  gasKitTransactionId: string;
  sponsorAddress: string;
  gasBudget: number;
  gasCoin: DemoGasCoin;
  expiresAt?: number;
}

interface StoredDemoReservationBinding extends DemoReservationBinding {
  expiresAt: number;
  inFlight: boolean;
}

export interface DemoReservationStore {
  put(binding: DemoReservationBinding): void;
  beginExecute(input: DemoReservationLookup): DemoReservationBinding | undefined;
  executeState(input: DemoReservationLookup): "ready" | "in-flight" | "not-found";
  releaseExecute(gasKitTransactionId: string): void;
  markExecuted(gasKitTransactionId: string): void;
}

export interface DemoReservationLookup {
    demoSessionId: string;
    walletAddress: string;
    reservationId: string;
    gasKitTransactionId: string;
}

export interface DemoReservationStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export function createDemoReservationStore(options: DemoReservationStoreOptions = {}): DemoReservationStore {
  const ttlMs = options.ttlMs ?? 2 * 60 * 1000;
  const now = options.now ?? Date.now;
  const bindings = new Map<string, StoredDemoReservationBinding>();

  function prune(): void {
    const current = now();
    for (const [id, binding] of bindings) {
      if (binding.expiresAt <= current) bindings.delete(id);
    }
  }

  return {
    put(binding: DemoReservationBinding): void {
      prune();
      bindings.set(binding.gasKitTransactionId, {
        ...binding,
        expiresAt: binding.expiresAt ?? now() + ttlMs,
        inFlight: false,
      });
    },

    beginExecute(input: DemoReservationLookup): DemoReservationBinding | undefined {
      prune();
      const binding = bindings.get(input.gasKitTransactionId);
      if (binding === undefined || binding.inFlight) return undefined;
      if (
        binding.demoSessionId !== input.demoSessionId ||
        binding.walletAddress !== input.walletAddress ||
        binding.reservationId !== input.reservationId
      ) {
        return undefined;
      }
      binding.inFlight = true;
      const { inFlight: _inFlight, ...publicBinding } = binding;
      return publicBinding;
    },

    executeState(input: DemoReservationLookup): "ready" | "in-flight" | "not-found" {
      prune();
      const binding = bindings.get(input.gasKitTransactionId);
      if (binding === undefined) return "not-found";
      if (
        binding.demoSessionId !== input.demoSessionId ||
        binding.walletAddress !== input.walletAddress ||
        binding.reservationId !== input.reservationId
      ) {
        return "not-found";
      }
      return binding.inFlight ? "in-flight" : "ready";
    },

    releaseExecute(gasKitTransactionId: string): void {
      prune();
      const binding = bindings.get(gasKitTransactionId);
      if (binding !== undefined) binding.inFlight = false;
    },

    markExecuted(gasKitTransactionId: string): void {
      prune();
      bindings.delete(gasKitTransactionId);
    },
  };
}
