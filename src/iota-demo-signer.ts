import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";

import type { DemoSigner } from "./demo-signer.js";

export async function createIotaDemoSigner(): Promise<DemoSigner> {
  const keypair = Ed25519Keypair.generate();

  return {
    address: keypair.toIotaAddress(),
    async signTransaction(bytes: Uint8Array): Promise<string> {
      const { signature } = await keypair.signTransaction(bytes);
      return signature;
    },
  };
}
