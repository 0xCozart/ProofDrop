import { createGasKitClient, GasKitAuthError, GasKitError, GasKitPolicyError } from "@iota-gaskit/sdk";
import type {
  ExecuteSponsoredTransactionRequest,
  ExecuteSponsoredTransactionResponse,
  GasKitClientOptions,
  PolicySimulationRequest,
  PolicySimulationResponse,
  ReserveGasRequest,
  ReserveGasResponse,
} from "@iota-gaskit/sdk";

export type ProofDropMode = "mock" | "live";

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
  liveUnavailableReason?: string;
  packageId?: string;
  functionName?: string;
  maxGasBudget?: number;
  explorerBaseUrl?: string;
}

export interface ProofDropEnv {
  PROOFDROP_MODE?: string;
  PROOFDROP_PACKAGE_ID?: string;
  PROOFDROP_FUNCTION_NAME?: string;
  PROOFDROP_MAX_GAS_BUDGET?: string;
  PROOFDROP_EXPLORER_BASE_URL?: string;
  GASKIT_GATEWAY_URL?: string;
  GASKIT_PROOFDROP_APP_KEY?: string;
}

interface SponsorshipInput {
  gasBudget: number;
  walletAddress: string;
  packageId: string;
  functionName: string;
}

const DEFAULT_PACKAGE_ID = "0xPROOFDROP_PACKAGE";
const DEFAULT_FUNCTION_NAME = "claim_proof_badge";
const DEFAULT_MAX_GAS_BUDGET = 50_000_000;
const DEFAULT_RESERVATION_SECS = 30;
const DEFAULT_EXPLORER_BASE_URL = "https://explorer.iota.org/txblock";

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

function badRequest(message: string): Response {
  return jsonResponse(400, {
    error: "BAD_REQUEST",
    message,
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

function requiredGasBudget(body: Record<string, unknown>, maxGasBudget: number): number | Response {
  const value = body["gasBudget"];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return badRequest("gasBudget must be a positive safe integer.");
  }
  if (value > maxGasBudget) {
    return badRequest(`gasBudget must be no greater than ${maxGasBudget}.`);
  }
  return value;
}

function sponsorshipInputFromBody(body: Record<string, unknown>, maxGasBudget: number): SponsorshipInput | Response {
  const gasBudget = requiredGasBudget(body, maxGasBudget);
  if (gasBudget instanceof Response) return gasBudget;
  const walletAddress = requiredString(body, "walletAddress");
  if (walletAddress instanceof Response) return walletAddress;
  const packageId = requiredString(body, "packageId");
  if (packageId instanceof Response) return packageId;
  const functionName = requiredString(body, "functionName");
  if (functionName instanceof Response) return functionName;

  return {
    gasBudget,
    walletAddress,
    packageId,
    functionName,
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

function safeErrorResponse(error: unknown, mode: ProofDropMode): Response {
  if (error instanceof GasKitAuthError) {
    return jsonResponse(401, {
      error: "AUTH_FAILED",
      message: "Sponsorship service authentication failed.",
      mode,
    });
  }

  if (error instanceof GasKitPolicyError) {
    return jsonResponse(200, {
      sponsored: false,
      decision: {
        allowed: false,
        ...(safePolicyReasonCode(error.reasonCode) === undefined ? {} : { reasonCode: error.reasonCode }),
        message: "Request rejected by ProofDrop sponsorship policy.",
      },
      mode,
    });
  }

  if (error instanceof GasKitError) {
    return jsonResponse(error.status !== undefined && error.status >= 500 ? error.status : 502, {
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
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(digest)}`;
}

export function createProofDropApi(options: ProofDropApiOptions) {
  const packageId = options.packageId ?? DEFAULT_PACKAGE_ID;
  const functionName = options.functionName ?? DEFAULT_FUNCTION_NAME;
  const maxGasBudget = options.maxGasBudget ?? DEFAULT_MAX_GAS_BUDGET;
  const explorerBaseUrl = options.explorerBaseUrl ?? DEFAULT_EXPLORER_BASE_URL;
  const liveAvailable = options.mode === "live" && options.liveAvailable === true;
  const liveUnavailableReason = options.liveUnavailableReason ?? "Live testnet mode is not configured on this server.";

  function assertLiveAvailable(): Response | undefined {
    if (options.mode === "live" && !liveAvailable) {
      return liveUnavailable(liveUnavailableReason);
    }
    return undefined;
  }

  async function simulate(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();
    const unavailable = assertLiveAvailable();
    if (unavailable !== undefined) return unavailable;
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const input = sponsorshipInputFromBody(body, maxGasBudget);
    if (input instanceof Response) return input;

    try {
      const decision = await options.client.simulatePolicy(input);
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
    const input = sponsorshipInputFromBody(body, maxGasBudget);
    if (input instanceof Response) return input;

    try {
      const decision = await options.client.simulatePolicy(input);
      if (!decision.allowed) {
        return jsonResponse(200, {
          sponsored: false,
          decision,
          mode: options.mode,
        });
      }

      const reservation = await options.client.reserveGas({
        ...input,
        reserveDurationSecs: DEFAULT_RESERVATION_SECS,
      });

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
      return jsonResponse(200, {
        sponsored: true,
        ...(executed.digest === undefined ? {} : { digest: executed.digest }),
        ...(explorerUrl(explorerBaseUrl, executed.digest) === undefined
          ? {}
          : { explorerUrl: explorerUrl(explorerBaseUrl, executed.digest) }),
        mode: options.mode,
      });
    } catch (error) {
      return safeErrorResponse(error, options.mode);
    }
  }

  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/api/health" && request.method === "GET") {
        return jsonResponse(200, {
          ok: true,
          app: "Gasless ProofDrop",
          mode: options.mode,
          liveAvailable,
          packageId,
          functionName,
        });
      }
      if (url.pathname === "/api/sponsorship/simulate") return simulate(request);
      if (url.pathname === "/api/sponsorship/reserve") return reserve(request);
      if (url.pathname === "/api/sponsorship/execute") return execute(request);

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
        throw new GasKitPolicyError(decision.message, decision.reasonCode, 400);
      }
      return {
        reservationId: "proofdrop-mock-reservation-1",
        gasKitTransactionId: "proofdrop-mock-tx-1",
        sponsorAddress: "0xMOCK_PROOFDROP_SPONSOR",
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
        throw new GasKitPolicyError("Reservation is not valid for the mock ProofDrop flow.", "AUTH_INVALID", 400);
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

function hasUsableLiveConfig(env: ProofDropEnv): env is ProofDropEnv & Required<Pick<ProofDropEnv, "GASKIT_GATEWAY_URL" | "GASKIT_PROOFDROP_APP_KEY">> {
  return (
    typeof env.GASKIT_GATEWAY_URL === "string" &&
    env.GASKIT_GATEWAY_URL.startsWith("http") &&
    typeof env.GASKIT_PROOFDROP_APP_KEY === "string" &&
    env.GASKIT_PROOFDROP_APP_KEY.length > 0 &&
    !env.GASKIT_PROOFDROP_APP_KEY.includes("replace-with")
  );
}

export function createProofDropApiFromEnv(env: ProofDropEnv = process.env): ReturnType<typeof createProofDropApi> {
  const mode = parseMode(env.PROOFDROP_MODE);
  const packageId = env.PROOFDROP_PACKAGE_ID ?? DEFAULT_PACKAGE_ID;
  const functionName = env.PROOFDROP_FUNCTION_NAME ?? DEFAULT_FUNCTION_NAME;
  const maxGasBudget = parseMaxGasBudget(env.PROOFDROP_MAX_GAS_BUDGET);
  const explorerBaseUrl = env.PROOFDROP_EXPLORER_BASE_URL ?? DEFAULT_EXPLORER_BASE_URL;

  if (mode === "live") {
    if (hasUsableLiveConfig(env)) {
      const clientOptions: GasKitClientOptions = {
        baseUrl: env.GASKIT_GATEWAY_URL,
        apiKey: env.GASKIT_PROOFDROP_APP_KEY,
      };

      return createProofDropApi({
        mode,
        liveAvailable: true,
        client: createGasKitClient(clientOptions),
        packageId,
        functionName,
        maxGasBudget,
        explorerBaseUrl,
      });
    }

    return createProofDropApi({
      mode,
      liveAvailable: false,
      liveUnavailableReason: "Live testnet mode is disabled until server-side GasKit credentials are configured.",
      client: createMockProofDropClient({ packageId, functionName, maxGasBudget }),
      packageId,
      functionName,
      maxGasBudget,
      explorerBaseUrl,
    });
  }

  return createProofDropApi({
    mode,
    liveAvailable: false,
    client: createMockProofDropClient({ packageId, functionName, maxGasBudget }),
    packageId,
    functionName,
    maxGasBudget,
    explorerBaseUrl,
  });
}
