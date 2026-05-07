import { randomBytes } from "node:crypto";

export interface DemoSigner {
  address: string;
  signTransaction(bytes: Uint8Array): Promise<string>;
}

export interface PublicDemoSignerSession {
  demoSessionId: string;
  address: string;
  expiresAt: number;
}

export interface StoredDemoSignerSession extends PublicDemoSignerSession {
  signer: DemoSigner;
}

export interface DemoSignerStoreOptions {
  ttlMs?: number;
  maxSessions?: number;
  maxCreatesPerDay?: number;
  maxExecutesPerDay?: number;
  now?: () => number;
  generateSigner: () => Promise<DemoSigner>;
}

export interface DemoSignerStore {
  create(): Promise<PublicDemoSignerSession>;
  get(id: string): StoredDemoSignerSession | undefined;
  claimExecutePermit(): () => void;
  markUsed(id: string): void;
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function createDemoSignerStore(options: DemoSignerStoreOptions): DemoSignerStore {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxSessions = options.maxSessions ?? 100;
  const maxCreatesPerDay = options.maxCreatesPerDay ?? 500;
  const maxExecutesPerDay = options.maxExecutesPerDay ?? 100;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, StoredDemoSignerSession>();
  let counterDay = dayKey(now());
  let createsToday = 0;
  let executesToday = 0;

  function prune(): void {
    const current = now();
    const currentDay = dayKey(current);
    if (currentDay !== counterDay) {
      counterDay = currentDay;
      createsToday = 0;
      executesToday = 0;
    }

    for (const [id, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(id);
    }

    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  return {
    async create(): Promise<PublicDemoSignerSession> {
      prune();
      if (createsToday >= maxCreatesPerDay) {
        throw new Error("DEMO_SIGNER_CREATE_LIMIT_EXCEEDED");
      }

      const signer = await options.generateSigner();
      createsToday += 1;
      const session: StoredDemoSignerSession = {
        demoSessionId: `demo_${randomBytes(18).toString("base64url")}`,
        address: signer.address,
        expiresAt: now() + ttlMs,
        signer,
      };

      sessions.set(session.demoSessionId, session);
      prune();

      return {
        demoSessionId: session.demoSessionId,
        address: session.address,
        expiresAt: session.expiresAt,
      };
    },

    get(id: string): StoredDemoSignerSession | undefined {
      prune();
      return sessions.get(id);
    },

    claimExecutePermit(): () => void {
      prune();
      if (executesToday >= maxExecutesPerDay) {
        throw new Error("DEMO_SIGNER_EXECUTE_LIMIT_EXCEEDED");
      }
      executesToday += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          executesToday = Math.max(0, executesToday - 1);
        }
      };
    },

    markUsed(id: string): void {
      prune();
      sessions.delete(id);
    },
  };
}
