import type { DemoGasCoin, DemoReservationStore } from "./demo-reservation-store.js";
import { createDemoReservationStore } from "./demo-reservation-store.js";
import type { DemoSignerStore } from "./demo-signer.js";
import { createDemoSignerStore } from "./demo-signer.js";
import { createIotaDemoSigner } from "./iota-demo-signer.js";
import type { BuildSponsoredDemoTransactionInput } from "./live-transaction.js";
import { buildSponsoredDemoTransaction } from "./live-transaction.js";

export type ProofDropMode = "mock" | "live";

export interface PolicySimulationRequest {
  walletAddress: string;
  packageId: string;
  functionName: string;
  gasBudget?: number;
}

export interface PolicySimulationResponse {
  allowed: boolean;
  reasonCode?: string;
  message?: string;
}

export interface ReserveGasRequest extends PolicySimulationRequest {
  reserveDurationSecs?: number;
}

export interface ReserveGasResponse {
  reservationId: string;
  gasKitTransactionId: string;
  sponsorAddress?: string;
  gasCoins?: Array<{ objectId?: string; version?: string | number; digest?: string }>;
  raw?: unknown;
}

export interface ExecuteSponsoredTransactionRequest {
  reservationId: string;
  gasKitTransactionId: string;
  transactionBytes: string;
  userSignature: string;
}

export interface ExecuteSponsoredTransactionResponse {
  digest?: string;
  raw?: unknown;
}

export interface ProofDropGasKitClient {
  simulatePolicy(request: PolicySimulationRequest): Promise<PolicySimulationResponse>;
  reserveGas(request: ReserveGasRequest): Promise<ReserveGasResponse>;
  executeSponsoredTransaction(
    request: ExecuteSponsoredTransactionRequest,
  ): Promise<ExecuteSponsoredTransactionResponse>;
}

export interface ProofDropApiOptions {
  mode: ProofDropMode;
  client: ProofDropGasKitClient;
  liveAvailable?: boolean;
  liveAvailabilityCheck?: () => Promise<void>;
  liveUnavailableReason?: string;
  packageId?: string;
  moduleName?: string;
  functionName?: string;
  maxGasBudget?: number;
  explorerBaseUrl?: string;
  demoSignerStore?: DemoSignerStore;
  demoReservationStore?: DemoReservationStore;
  demoSignerLiveExecutionEnabled?: boolean;
  iotaRpcUrl?: string;
  now?: () => number;
  buildSponsoredDemoTransaction?: (input: BuildSponsoredDemoTransactionInput) => Promise<{ transactionBytes: string; rawBytes?: Uint8Array }>;
}

export interface ProofDropEnv {
  PROOFDROP_MODE?: string;
  PROOFDROP_PACKAGE_ID?: string;
  PROOFDROP_MODULE_NAME?: string;
  PROOFDROP_FUNCTION_NAME?: string;
  PROOFDROP_MAX_GAS_BUDGET?: string;
  PROOFDROP_EXPLORER_BASE_URL?: string;
  PROOFDROP_DEMO_SIGNER_ENABLED?: string;
  PROOFDROP_DEMO_SIGNER_TTL_SECS?: string;
  PROOFDROP_DEMO_SIGNER_MAX_ACTIVE?: string;
  PROOFDROP_DEMO_SIGNER_MAX_CREATES_PER_DAY?: string;
  PROOFDROP_DEMO_SIGNER_MAX_EXECUTES_PER_DAY?: string;
  IOTA_RPC_URL?: string;
  GASKIT_GATEWAY_URL?: string;
  GASKIT_PROOFDROP_APP_KEY?: string;
  GASKIT_SDK_MODULE?: string;
}

interface SponsorshipInput {
  gasBudget: number;
  walletAddress: string;
  packageId: string;
  functionName: string;
  demoSessionId?: string;
}

export class ProofDropAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "ProofDropAuthError";
  }
}

export class ProofDropPolicyError extends Error {
  constructor(
    message: string,
    readonly reasonCode: string | undefined,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProofDropPolicyError";
  }
}

export class ProofDropUpstreamError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "ProofDropUpstreamError";
  }
}

export class ProofDropLiveUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofDropLiveUnavailableError";
  }
}

const DEFAULT_PACKAGE_ID = "0xPROOFDROP_PACKAGE";
const DEFAULT_MODULE_NAME = "proofdrop_badge";
const DEFAULT_FUNCTION_NAME = "claim_proof_badge";
const DEFAULT_MAX_GAS_BUDGET = 50_000_000;
const DEFAULT_RESERVATION_SECS = 30;
const DEFAULT_EXPLORER_BASE_URL = "https://explorer.iota.org/txblock/{digest}?network=testnet";
const DEFAULT_IOTA_RPC_URL = "https://api.testnet.iota.cafe";

const KNOWN_POLICY_REASON_CODES = new Set([
  "AUTH_MISSING",
  "AUTH_INVALID",
  "APP_DISABLED",
  "APP_DAILY_REQUEST_LIMIT_EXCEEDED",
  "GAS_BUDGET_TOO_HIGH",
  "PACKAGE_NOT_ALLOWED",
  "FUNCTION_NOT_ALLOWED",
  "WALLET_DENIED",
]);

function jsonResponse(status: number, body: object, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function methodNotAllowed(): Response {
  return jsonResponse(
    405,
    {
      error: "METHOD_NOT_ALLOWED",
      message: "Use the documented HTTP method for this ProofDrop endpoint.",
    },
    { allow: "POST" },
  );
}

function methodNotAllowedFor(allow: string): Response {
  return jsonResponse(
    405,
    {
      error: "METHOD_NOT_ALLOWED",
      message: "Use the documented HTTP method for this ProofDrop endpoint.",
    },
    { allow },
  );
}

function badRequest(message: string, error = "BAD_REQUEST"): Response {
  return jsonResponse(400, { error, message });
}

function demoSignerUnavailable(message = "Demo signer is unavailable on this server."): Response {
  return jsonResponse(503, {
    error: "DEMO_SIGNER_UNAVAILABLE",
    message,
  });
}

function demoSignerExpired(): Response {
  return badRequest("The ephemeral demo signer expired. Generate a new demo signer.", "DEMO_SIGNER_EXPIRED");
}

function demoReservationNotFound(): Response {
  return badRequest("The demo reservation is not valid for this signer session.", "DEMO_RESERVATION_NOT_FOUND");
}

function demoExecuteInProgress(): Response {
  return jsonResponse(409, {
    error: "DEMO_EXECUTE_IN_PROGRESS",
    message: "This demo reservation is already executing.",
  });
}

async function readObjectBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonResponse(415, {
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Request content-type must be application/json.",
    });
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return badRequest("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string | Response {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return badRequest(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalDemoSessionId(body: Record<string, unknown>): string | Response | undefined {
  const value = body["demoSessionId"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^demo_[A-Za-z0-9_-]{12,}$/.test(value)) {
    return badRequest("demoSessionId must be a valid ephemeral demo signer session.", "DEMO_SIGNER_EXPIRED");
  }
  return value;
}

function optionalGasBudget(body: Record<string, unknown>, maxGasBudget: number): number | Response {
  const value = body["gasBudget"];
  if (value === undefined) return maxGasBudget;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return badRequest("gasBudget must be a positive safe integer.");
  }
  if (value > maxGasBudget) {
    return badRequest(`gasBudget must be no greater than ${maxGasBudget}.`);
  }
  return value;
}

function sponsorshipInputFromBody(
  body: Record<string, unknown>,
  target: { packageId: string; functionName: string; maxGasBudget: number },
): SponsorshipInput | Response {
  if (body["packageId"] !== undefined || body["moduleName"] !== undefined || body["functionName"] !== undefined) {
    return badRequest(
      "ProofDrop packageId, moduleName, and functionName are server-owned policy targets and cannot be supplied by the browser.",
      "CLIENT_POLICY_TARGET_FORBIDDEN",
    );
  }

  const gasBudget = optionalGasBudget(body, target.maxGasBudget);
  if (gasBudget instanceof Response) return gasBudget;
  const walletAddress = requiredString(body, "walletAddress");
  if (walletAddress instanceof Response) return walletAddress;
  const demoSessionId = optionalDemoSessionId(body);
  if (demoSessionId instanceof Response) return demoSessionId;

  return {
    gasBudget,
    walletAddress,
    packageId: target.packageId,
    functionName: target.functionName,
    ...(demoSessionId === undefined ? {} : { demoSessionId }),
  };
}

function demoExecuteInputFromBody(body: Record<string, unknown>): {
  demoSessionId: string;
  reservationId: string;
  gasKitTransactionId: string;
} | Response {
  const demoSessionId = optionalDemoSessionId(body);
  if (demoSessionId instanceof Response) return demoSessionId;
  if (demoSessionId === undefined) return badRequest("demoSessionId must be supplied.", "DEMO_SIGNER_EXPIRED");
  const reservationId = requiredString(body, "reservationId");
  if (reservationId instanceof Response) return reservationId;
  const gasKitTransactionId = requiredString(body, "gasKitTransactionId");
  if (gasKitTransactionId instanceof Response) return gasKitTransactionId;

  return { demoSessionId, reservationId, gasKitTransactionId };
}

function firstUsableGasCoin(reservation: ReserveGasResponse): DemoGasCoin | undefined {
  const gasCoin = reservation.gasCoins?.[0];
  if (
    gasCoin?.objectId === undefined ||
    gasCoin.version === undefined ||
    gasCoin.digest === undefined
  ) {
    return undefined;
  }
  return {
    objectId: gasCoin.objectId,
    version: gasCoin.version,
    digest: gasCoin.digest,
  };
}

function executeInputFromBody(body: Record<string, unknown>): ExecuteSponsoredTransactionRequest | Response {
  const reservationId = requiredString(body, "reservationId");
  if (reservationId instanceof Response) return reservationId;
  const gasKitTransactionId = requiredString(body, "gasKitTransactionId");
  if (gasKitTransactionId instanceof Response) return gasKitTransactionId;
  const transactionBytes = requiredString(body, "transactionBytes");
  if (transactionBytes instanceof Response) return transactionBytes;
  const userSignature = requiredString(body, "userSignature");
  if (userSignature instanceof Response) return userSignature;

  return {
    reservationId,
    gasKitTransactionId,
    transactionBytes,
    userSignature,
  };
}

function safePolicyReasonCode(reasonCode: string | undefined): string | undefined {
  return reasonCode !== undefined && KNOWN_POLICY_REASON_CODES.has(reasonCode) ? reasonCode : undefined;
}

function isNamedError(error: unknown, names: string[]): error is Error & { status?: number; reasonCode?: string } {
  return error instanceof Error && names.includes(error.name);
}

function safeErrorResponse(error: unknown, mode: ProofDropMode): Response {
  if (error instanceof ProofDropLiveUnavailableError) {
    return liveUnavailable(error.message);
  }

  if (error instanceof ProofDropAuthError || isNamedError(error, ["GasKitAuthError"])) {
    return jsonResponse(401, {
      error: "AUTH_FAILED",
      message: "Sponsorship service authentication failed.",
      mode,
    });
  }

  if (error instanceof ProofDropPolicyError || isNamedError(error, ["GasKitPolicyError"])) {
    const reasonCode = safePolicyReasonCode(error.reasonCode);
    return jsonResponse(200, {
      sponsored: false,
      decision: {
        allowed: false,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        message: "Request rejected by ProofDrop sponsorship policy.",
      },
      mode,
    });
  }

  if (error instanceof ProofDropUpstreamError || isNamedError(error, ["GasKitError"])) {
    const status = typeof error.status === "number" && error.status >= 500 ? error.status : 502;
    return jsonResponse(status, {
      error: "GASKIT_REQUEST_FAILED",
      message: "Sponsorship service is unavailable.",
      mode,
    });
  }

  return jsonResponse(500, {
    error: "INTERNAL_ERROR",
    message: "Internal server error.",
    mode,
  });
}

function liveUnavailable(message: string): Response {
  return jsonResponse(503, {
    error: "LIVE_TESTNET_UNAVAILABLE",
    message,
    mode: "live",
  });
}

function explorerUrl(baseUrl: string, digest: string | undefined): string | undefined {
  if (digest === undefined) return undefined;
  const encodedDigest = encodeURIComponent(digest);
  if (baseUrl.includes("{digest}")) {
    return baseUrl.replaceAll("{digest}", encodedDigest);
  }
  return `${baseUrl.replace(/\/+$/, "")}/${encodedDigest}`;
}

export function createProofDropApi(options: ProofDropApiOptions) {
  const packageId = options.packageId ?? DEFAULT_PACKAGE_ID;
  const moduleName = options.moduleName ?? DEFAULT_MODULE_NAME;
  const functionName = options.functionName ?? DEFAULT_FUNCTION_NAME;
  const maxGasBudget = options.maxGasBudget ?? DEFAULT_MAX_GAS_BUDGET;
  const explorerBaseUrl = options.explorerBaseUrl ?? DEFAULT_EXPLORER_BASE_URL;
  const liveAvailable = options.mode === "live" && options.liveAvailable === true;
  const liveUnavailableReason = options.liveUnavailableReason ?? "Live testnet mode is not configured on this server.";
  const now = options.now ?? Date.now;
  const demoSignerStore = options.demoSignerStore ?? createDemoSignerStore({ generateSigner: createIotaDemoSigner });
  const demoReservationStore = options.demoReservationStore ?? createDemoReservationStore();
  const transactionBuilder = options.buildSponsoredDemoTransaction ?? buildSponsoredDemoTransaction;

  function assertLiveAvailable(): Response | undefined {
    if (options.mode === "live" && !liveAvailable) {
      return liveUnavailable(liveUnavailableReason);
    }
    return undefined;
  }

  function inputForDemoSigner(input: SponsorshipInput): SponsorshipInput | Response {
    if (input.demoSessionId === undefined) return input;
    const session = demoSignerStore.get(input.demoSessionId);
    if (session === undefined) return demoSignerExpired();
    return {
      ...input,
      walletAddress: session.address,
    };
  }

  async function simulate(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();
    const unavailable = assertLiveAvailable();
    if (unavailable !== undefined) return unavailable;
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const input = sponsorshipInputFromBody(body, { packageId, functionName, maxGasBudget });
    if (input instanceof Response) return input;
    const effectiveInput = inputForDemoSigner(input);
    if (effectiveInput instanceof Response) return effectiveInput;

    try {
      const decision = await options.client.simulatePolicy(effectiveInput);
      return jsonResponse(200, {
        sponsored: decision.allowed,
        decision,
        mode: options.mode,
      });
    } catch (error) {
      return safeErrorResponse(error, options.mode);
    }
  }

  async function reserve(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();
    const unavailable = assertLiveAvailable();
    if (unavailable !== undefined) return unavailable;
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const input = sponsorshipInputFromBody(body, { packageId, functionName, maxGasBudget });
    if (input instanceof Response) return input;
    const effectiveInput = inputForDemoSigner(input);
    if (effectiveInput instanceof Response) return effectiveInput;

    try {
      const decision = await options.client.simulatePolicy(effectiveInput);
      if (!decision.allowed) {
        return jsonResponse(200, {
          sponsored: false,
          decision,
          mode: options.mode,
        });
      }

      const reservation = await options.client.reserveGas({
        ...effectiveInput,
        reserveDurationSecs: DEFAULT_RESERVATION_SECS,
      });

      if (effectiveInput.demoSessionId !== undefined) {
        const gasCoin = firstUsableGasCoin(reservation);
        if (reservation.sponsorAddress === undefined || gasCoin === undefined) {
          return jsonResponse(502, {
            error: "GASKIT_REQUEST_FAILED",
            message: "Sponsorship service did not return a usable demo gas reservation.",
            mode: options.mode,
          });
        }
        demoReservationStore.put({
          demoSessionId: effectiveInput.demoSessionId,
          walletAddress: effectiveInput.walletAddress,
          reservationId: reservation.reservationId,
          gasKitTransactionId: reservation.gasKitTransactionId,
          sponsorAddress: reservation.sponsorAddress,
          gasBudget: effectiveInput.gasBudget,
          gasCoin,
        });
      }

      return jsonResponse(200, {
        sponsored: true,
        reservationId: reservation.reservationId,
        gasKitTransactionId: reservation.gasKitTransactionId,
        ...(reservation.sponsorAddress === undefined ? {} : { sponsorAddress: reservation.sponsorAddress }),
        expiresInSecs: DEFAULT_RESERVATION_SECS,
        mode: options.mode,
      });
    } catch (error) {
      return safeErrorResponse(error, options.mode);
    }
  }

  async function execute(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();
    const unavailable = assertLiveAvailable();
    if (unavailable !== undefined) return unavailable;
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const input = executeInputFromBody(body);
    if (input instanceof Response) return input;

    try {
      const executed = await options.client.executeSponsoredTransaction(input);
      const url = explorerUrl(explorerBaseUrl, executed.digest);
      return jsonResponse(200, {
        sponsored: true,
        ...(executed.digest === undefined ? {} : { digest: executed.digest }),
        ...(url === undefined ? {} : { explorerUrl: url }),
        mode: options.mode,
      });
    } catch (error) {
      return safeErrorResponse(error, options.mode);
    }
  }

  async function demoExecute(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const input = demoExecuteInputFromBody(body);
    if (input instanceof Response) return input;

    const session = demoSignerStore.get(input.demoSessionId);
    if (session === undefined) return demoSignerExpired();

    const binding = demoReservationStore.beginExecute({
      ...input,
      walletAddress: session.address,
    });
    if (binding === undefined) {
      const state = demoReservationStore.executeState({
        ...input,
        walletAddress: session.address,
      });
      return state === "in-flight" ? demoExecuteInProgress() : demoReservationNotFound();
    }

    let releasePermit: (() => void) | undefined;
    try {
      releasePermit = demoSignerStore.claimExecutePermit();
    } catch {
      demoReservationStore.releaseExecute(input.gasKitTransactionId);
      return demoSignerUnavailable("Demo signer execution limit has been reached.");
    }

    try {
      let transactionBytes: string;
      let userSignature: string;

      if (options.mode === "mock") {
        transactionBytes = "mock-proofdrop-transaction-bytes";
        userSignature = await session.signer.signTransaction(new Uint8Array([1, 2, 3]));
      } else {
        if (options.demoSignerLiveExecutionEnabled !== true) {
          demoReservationStore.releaseExecute(input.gasKitTransactionId);
          releasePermit();
          return demoSignerUnavailable("Live demo signer execution is disabled on this server.");
        }
        const unavailable = assertLiveAvailable();
        if (unavailable !== undefined) {
          demoReservationStore.releaseExecute(input.gasKitTransactionId);
          releasePermit();
          return unavailable;
        }
        const rpcUrl = options.iotaRpcUrl ?? DEFAULT_IOTA_RPC_URL;
        const built = await transactionBuilder({
          rpcUrl,
          packageId,
          moduleName,
          functionName,
          gasBudget: binding.gasBudget,
          senderAddress: session.address,
          sponsorAddress: binding.sponsorAddress,
          gasCoin: binding.gasCoin,
        });
        transactionBytes = built.transactionBytes;
        const rawBytes = built.rawBytes ?? new Uint8Array();
        userSignature = await session.signer.signTransaction(rawBytes);
      }

      const executed = await options.client.executeSponsoredTransaction({
        reservationId: input.reservationId,
        gasKitTransactionId: input.gasKitTransactionId,
        transactionBytes,
        userSignature,
      });
      demoReservationStore.markExecuted(input.gasKitTransactionId);
      demoSignerStore.markUsed(input.demoSessionId);
      const url = explorerUrl(explorerBaseUrl, executed.digest);
      return jsonResponse(200, {
        sponsored: true,
        ...(executed.digest === undefined ? {} : { digest: executed.digest }),
        ...(url === undefined ? {} : { explorerUrl: url }),
        mode: options.mode,
      });
    } catch (error) {
      releasePermit();
      demoReservationStore.markExecuted(input.gasKitTransactionId);
      return safeErrorResponse(error, options.mode);
    }
  }

  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/api/health" && request.method === "GET") {
        let healthLiveAvailable = liveAvailable;
        let healthLiveUnavailableReason = liveUnavailableReason;
        if (options.mode === "live" && liveAvailable && options.liveAvailabilityCheck !== undefined) {
          try {
            await options.liveAvailabilityCheck();
          } catch (error) {
            healthLiveAvailable = false;
            healthLiveUnavailableReason =
              error instanceof ProofDropLiveUnavailableError
                ? error.message
                : "Live testnet mode is not available on this server.";
          }
        }
        return jsonResponse(200, {
          ok: true,
          app: "Gasless ProofDrop",
          mode: options.mode,
          liveAvailable: healthLiveAvailable,
          ...(healthLiveAvailable ? {} : { liveUnavailableReason: healthLiveUnavailableReason }),
          packageId,
          moduleName,
          functionName,
        });
      }
      if (url.pathname === "/api/demo-address" && request.method !== "GET") {
        return methodNotAllowedFor("GET");
      }
      if (url.pathname === "/api/demo-address") {
        try {
          const session = await demoSignerStore.create();
          return jsonResponse(200, {
            demoSessionId: session.demoSessionId,
            address: session.address,
            network: "iota-testnet",
            ephemeral: true,
            signingAvailable: true,
            expiresInSecs: Math.max(0, Math.floor((session.expiresAt - now()) / 1000)),
            message: "Ephemeral server-side demo signer. No browser wallet is connected.",
          });
        } catch {
          return demoSignerUnavailable("Could not create an ephemeral demo signer.");
        }
      }
      if (url.pathname === "/api/sponsorship/simulate") return simulate(request);
      if (url.pathname === "/api/sponsorship/reserve") return reserve(request);
      if (url.pathname === "/api/sponsorship/execute") return execute(request);
      if (url.pathname === "/api/sponsorship/demo-execute") return demoExecute(request);

      return jsonResponse(404, {
        error: "NOT_FOUND",
        message: "ProofDrop endpoint not found.",
      });
    },
  };
}

export function createMockProofDropClient(options: {
  packageId?: string;
  functionName?: string;
  maxGasBudget?: number;
  deniedWallet?: string;
} = {}): ProofDropGasKitClient {
  const packageId = options.packageId ?? DEFAULT_PACKAGE_ID;
  const functionName = options.functionName ?? DEFAULT_FUNCTION_NAME;
  const maxGasBudget = options.maxGasBudget ?? DEFAULT_MAX_GAS_BUDGET;
  const deniedWallet = options.deniedWallet ?? "0xDENIED_PROOFDROP_WALLET";

  async function simulatePolicy(request: PolicySimulationRequest): Promise<PolicySimulationResponse> {
    if (request.walletAddress === deniedWallet) {
      return {
        allowed: false,
        reasonCode: "WALLET_DENIED",
        message: "Wallet is denied by ProofDrop policy.",
      };
    }
    if (request.gasBudget !== undefined && request.gasBudget > maxGasBudget) {
      return {
        allowed: false,
        reasonCode: "GAS_BUDGET_TOO_HIGH",
        message: "Requested gas budget exceeds the ProofDrop policy.",
      };
    }
    if (request.packageId !== packageId) {
      return {
        allowed: false,
        reasonCode: "PACKAGE_NOT_ALLOWED",
        message: "Package is not allowlisted for ProofDrop sponsorship.",
      };
    }
    if (request.functionName !== functionName) {
      return {
        allowed: false,
        reasonCode: "FUNCTION_NOT_ALLOWED",
        message: "Function is not allowlisted for ProofDrop sponsorship.",
      };
    }
    return { allowed: true };
  }

  return {
    simulatePolicy,
    async reserveGas(request: ReserveGasRequest): Promise<ReserveGasResponse> {
      const decision = await simulatePolicy(request);
      if (!decision.allowed) {
        throw new ProofDropPolicyError(decision.message ?? "Policy rejected.", decision.reasonCode, 400);
      }
      return {
        reservationId: "proofdrop-mock-reservation-1",
        gasKitTransactionId: "proofdrop-mock-tx-1",
        sponsorAddress: "0xMOCK_PROOFDROP_SPONSOR",
        gasCoins: [{ objectId: "0xMOCK_PROOFDROP_GAS_COIN", version: "1", digest: "mock-gas-coin-digest" }],
        raw: {
          mock: true,
        },
      };
    },
    async executeSponsoredTransaction(
      request: ExecuteSponsoredTransactionRequest,
    ): Promise<ExecuteSponsoredTransactionResponse> {
      if (
        request.reservationId !== "proofdrop-mock-reservation-1" ||
        request.gasKitTransactionId !== "proofdrop-mock-tx-1"
      ) {
        throw new ProofDropPolicyError("Reservation is not valid for the mock ProofDrop flow.", "AUTH_INVALID", 400);
      }
      return {
        digest: "0xMOCK_PROOFDROP_DIGEST",
        raw: {
          mock: true,
        },
      };
    },
  };
}

function parseMode(value: string | undefined): ProofDropMode {
  return value === "live" ? "live" : "mock";
}

function parseMaxGasBudget(value: string | undefined): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_GAS_BUDGET;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function hasUsableLiveConfig(
  env: ProofDropEnv,
): env is ProofDropEnv & Required<Pick<ProofDropEnv, "GASKIT_GATEWAY_URL" | "GASKIT_PROOFDROP_APP_KEY">> {
  return (
    typeof env.GASKIT_GATEWAY_URL === "string" &&
    env.GASKIT_GATEWAY_URL.startsWith("http") &&
    typeof env.GASKIT_PROOFDROP_APP_KEY === "string" &&
    env.GASKIT_PROOFDROP_APP_KEY.length > 0 &&
    !env.GASKIT_PROOFDROP_APP_KEY.includes("replace-with")
  );
}

function isProofDropGasKitClient(value: unknown): value is ProofDropGasKitClient {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.simulatePolicy === "function" &&
    typeof candidate.reserveGas === "function" &&
    typeof candidate.executeSponsoredTransaction === "function"
  );
}

function createLiveSdkClient(env: Required<Pick<ProofDropEnv, "GASKIT_GATEWAY_URL" | "GASKIT_PROOFDROP_APP_KEY">> & ProofDropEnv): ProofDropGasKitClient & { checkAvailable(): Promise<void> } {
  let loaded: Promise<ProofDropGasKitClient> | undefined;

  async function load(): Promise<ProofDropGasKitClient> {
    if (loaded !== undefined) return loaded;
    loaded = (async () => {
      const moduleName = env.GASKIT_SDK_MODULE ?? "@iota-gaskit/sdk";
      let sdkModule: unknown;
      try {
        sdkModule = await import(moduleName);
      } catch {
        throw new ProofDropLiveUnavailableError("Live GasKit SDK module is unavailable.");
      }

      const createGasKitClient = (sdkModule as { createGasKitClient?: unknown }).createGasKitClient;
      if (typeof createGasKitClient !== "function") {
        throw new ProofDropLiveUnavailableError("Live GasKit SDK module does not expose createGasKitClient().");
      }

      const client = createGasKitClient({
        baseUrl: env.GASKIT_GATEWAY_URL,
        apiKey: env.GASKIT_PROOFDROP_APP_KEY,
      });
      if (!isProofDropGasKitClient(client)) {
        throw new ProofDropLiveUnavailableError("Live GasKit SDK client is missing required sponsorship methods.");
      }
      return client;
    })();
    return loaded;
  }

  return {
    async checkAvailable(): Promise<void> {
      await load();
    },
    async simulatePolicy(request: PolicySimulationRequest): Promise<PolicySimulationResponse> {
      return (await load()).simulatePolicy(request);
    },
    async reserveGas(request: ReserveGasRequest): Promise<ReserveGasResponse> {
      return (await load()).reserveGas(request);
    },
    async executeSponsoredTransaction(
      request: ExecuteSponsoredTransactionRequest,
    ): Promise<ExecuteSponsoredTransactionResponse> {
      return (await load()).executeSponsoredTransaction(request);
    },
  };
}

export function createProofDropApiFromEnv(env: ProofDropEnv = process.env): ReturnType<typeof createProofDropApi> {
  const mode = parseMode(env.PROOFDROP_MODE);
  const packageId = env.PROOFDROP_PACKAGE_ID ?? DEFAULT_PACKAGE_ID;
  const moduleName = env.PROOFDROP_MODULE_NAME ?? DEFAULT_MODULE_NAME;
  const functionName = env.PROOFDROP_FUNCTION_NAME ?? DEFAULT_FUNCTION_NAME;
  const maxGasBudget = parseMaxGasBudget(env.PROOFDROP_MAX_GAS_BUDGET);
  const explorerBaseUrl = env.PROOFDROP_EXPLORER_BASE_URL ?? DEFAULT_EXPLORER_BASE_URL;
  const demoSignerStore = createDemoSignerStore({
    ttlMs: parsePositiveInteger(env.PROOFDROP_DEMO_SIGNER_TTL_SECS, 600) * 1000,
    maxSessions: parsePositiveInteger(env.PROOFDROP_DEMO_SIGNER_MAX_ACTIVE, 100),
    maxCreatesPerDay: parsePositiveInteger(env.PROOFDROP_DEMO_SIGNER_MAX_CREATES_PER_DAY, 500),
    maxExecutesPerDay: parsePositiveInteger(env.PROOFDROP_DEMO_SIGNER_MAX_EXECUTES_PER_DAY, 100),
    generateSigner: createIotaDemoSigner,
  });
  const demoReservationStore = createDemoReservationStore();

  if (mode === "live") {
    if (hasUsableLiveConfig(env)) {
      const liveClient = createLiveSdkClient(env);
      return createProofDropApi({
        mode,
        liveAvailable: true,
        liveAvailabilityCheck: liveClient.checkAvailable,
        client: liveClient,
        packageId,
        moduleName,
        functionName,
        maxGasBudget,
        explorerBaseUrl,
        demoSignerStore,
        demoReservationStore,
        demoSignerLiveExecutionEnabled: parseBoolean(env.PROOFDROP_DEMO_SIGNER_ENABLED),
        iotaRpcUrl: env.IOTA_RPC_URL ?? DEFAULT_IOTA_RPC_URL,
      });
    }

    return createProofDropApi({
      mode,
      liveAvailable: false,
      liveUnavailableReason: "Live testnet mode is disabled until server-side GasKit credentials are configured.",
      client: createMockProofDropClient({ packageId, functionName, maxGasBudget }),
      packageId,
      moduleName,
      functionName,
      maxGasBudget,
      explorerBaseUrl,
      demoSignerStore,
      demoReservationStore,
      demoSignerLiveExecutionEnabled: false,
      iotaRpcUrl: env.IOTA_RPC_URL ?? DEFAULT_IOTA_RPC_URL,
    });
  }

  return createProofDropApi({
    mode,
    liveAvailable: false,
    client: createMockProofDropClient({ packageId, functionName, maxGasBudget }),
    packageId,
    moduleName,
    functionName,
    maxGasBudget,
    explorerBaseUrl,
    demoSignerStore,
    demoReservationStore,
  });
}
