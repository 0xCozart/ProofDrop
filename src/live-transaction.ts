import { toBase64 } from "@iota/bcs";
import { IotaClient } from "@iota/iota-sdk/client";
import { Transaction } from "@iota/iota-sdk/transactions";

import type { DemoGasCoin } from "./demo-reservation-store.js";

export interface BuildSponsoredDemoTransactionInput {
  rpcUrl: string;
  packageId: string;
  moduleName: string;
  functionName: string;
  gasBudget: number;
  senderAddress: string;
  sponsorAddress: string;
  gasCoin: DemoGasCoin;
}

export interface BuiltSponsoredDemoTransaction {
  transactionBytes: string;
  rawBytes: Uint8Array;
}

export interface TransactionLike {
  setSender(value: string): unknown;
  setGasOwner(value: string): unknown;
  setGasBudget(value: number): unknown;
  setGasPayment(value: DemoGasCoin[]): unknown;
  moveCall(value: { target: string }): unknown;
  build(value: { client: unknown }): Promise<Uint8Array>;
}

export interface LiveTransactionDependencies {
  createTransaction?: () => TransactionLike;
  createClient?: (rpcUrl: string) => unknown;
  encodeBytes?: (bytes: Uint8Array) => string;
}

export async function buildSponsoredDemoTransaction(
  input: BuildSponsoredDemoTransactionInput,
  dependencies: LiveTransactionDependencies = {},
): Promise<BuiltSponsoredDemoTransaction> {
  const client = dependencies.createClient?.(input.rpcUrl) ?? new IotaClient({ url: input.rpcUrl });
  const tx: TransactionLike = dependencies.createTransaction?.() ?? (new Transaction() as unknown as TransactionLike);

  tx.setSender(input.senderAddress);
  tx.setGasOwner(input.sponsorAddress);
  tx.setGasBudget(input.gasBudget);
  tx.setGasPayment([input.gasCoin]);
  tx.moveCall({ target: `${input.packageId}::${input.moduleName}::${input.functionName}` });

  const rawBytes = await tx.build({ client });
  return {
    transactionBytes: (dependencies.encodeBytes ?? toBase64)(rawBytes),
    rawBytes,
  };
}
