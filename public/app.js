const proofdrop = {
  walletAddress: "",
  packageId: "0xPROOFDROP_PACKAGE",
  functionName: "claim_proof_badge",
  gasBudget: 50000000,
  reservation: null,
};

const timeline = [
  ["checking-sponsorship-policy", "Policy preflight"],
  ["gas-reserved", "Gas reserved"],
  ["waiting-for-user-signature", "Wallet signature"],
  ["executing-sponsored-transaction", "Sponsored execution"],
  ["success-with-digest", "Digest returned"],
];

const els = {
  mode: document.querySelector("[data-mode-label]"),
  live: document.querySelector("[data-live-status]"),
  wallet: document.querySelector("[data-wallet-status]"),
  walletInput: document.querySelector("#walletAddress"),
  connect: document.querySelector("#connectWallet"),
  denied: document.querySelector("#useDeniedWallet"),
  claim: document.querySelector("#claimButton"),
  reset: document.querySelector("#resetButton"),
  statusTitle: document.querySelector("[data-status-title]"),
  statusText: document.querySelector("[data-status-text]"),
  digest: document.querySelector("[data-digest]"),
  explorer: document.querySelector("[data-explorer]"),
  steps: new Map([...document.querySelectorAll("[data-step]")].map((node) => [node.dataset.step, node])),
};

function setState(state, title, text) {
  document.body.dataset.state = state;
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
  for (const [key, node] of els.steps) {
    const index = timeline.findIndex(([id]) => id === key);
    const activeIndex = timeline.findIndex(([id]) => id === state);
    node.dataset.status = activeIndex >= index ? "complete" : "pending";
    if (key === state) node.dataset.status = "active";
  }
}

function safeErrorMessage(body) {
  if (body && typeof body.message === "string") return body.message;
  if (body && body.decision && typeof body.decision.message === "string") return body.decision.message;
  return "The sponsorship request failed safely. No sponsor credentials or raw upstream data were exposed.";
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(safeErrorMessage(json));
    error.body = json;
    throw error;
  }
  return json;
}

async function loadHealth() {
  const health = await fetch("/api/health").then((response) => response.json());
  proofdrop.packageId = health.packageId;
  proofdrop.functionName = health.functionName;
  els.mode.textContent = health.mode === "live" ? "Live testnet mode" : "Mock/local mode active";
  els.mode.dataset.state = health.mode === "live" ? "live" : "mock-local-mode-active";
  els.live.textContent = health.liveAvailable
    ? "Live GasKit route is configured server-side."
    : "Live testnet unavailable by default; mock mode is safe for public preview.";
  if (health.mode === "live" && !health.liveAvailable) {
    setState("live-testnet-unavailable", "Live testnet unavailable", "This server has not enabled live GasKit credentials.");
  }
}

function setWallet(address) {
  proofdrop.walletAddress = address;
  els.walletInput.value = address;
  els.wallet.textContent = address ? `Wallet connected: ${address}` : "Wallet not connected";
  els.claim.disabled = !address;
  setState(
    address ? "wallet-connected" : "wallet-not-connected",
    address ? "Wallet connected" : "Wallet not connected",
    address
      ? "Ready to check ProofDrop sponsorship policy."
      : "Connect a wallet-like test address to start the claim flow.",
  );
}

async function claim() {
  const input = {
    walletAddress: proofdrop.walletAddress,
    packageId: proofdrop.packageId,
    functionName: proofdrop.functionName,
    gasBudget: proofdrop.gasBudget,
  };

  els.claim.disabled = true;
  els.digest.textContent = "";
  els.explorer.removeAttribute("href");
  els.explorer.textContent = "";

  try {
    setState("checking-sponsorship-policy", "Checking sponsorship policy", "The browser asks this app server for a GasKit policy preflight.");
    const simulated = await postJson("/api/sponsorship/simulate", input);
    if (!simulated.sponsored) {
      setState("policy-rejected", "Policy rejected", safeErrorMessage(simulated));
      return;
    }

    const reservation = await postJson("/api/sponsorship/reserve", input);
    if (!reservation.sponsored) {
      setState("policy-rejected", "Policy rejected", safeErrorMessage(reservation));
      return;
    }
    proofdrop.reservation = reservation;
    setState("gas-reserved", "Gas reserved", `Reservation ${reservation.reservationId} is ready for a user signature.`);

    setState("waiting-for-user-signature", "Waiting for user signature", "Mock signing is local-only. It does not prove live wallet signing.");
    await new Promise((resolve) => setTimeout(resolve, 450));
    const transactionBytes = "mock-proofdrop-transaction-bytes";
    const userSignature = "mock-proofdrop-user-signature";

    setState("executing-sponsored-transaction", "Executing sponsored transaction", "The backend calls GasKit execute with the reservation and user signature.");
    const executed = await postJson("/api/sponsorship/execute", {
      reservationId: reservation.reservationId,
      gasKitTransactionId: reservation.gasKitTransactionId,
      transactionBytes,
      userSignature,
    });

    setState("success-with-digest", "Badge claim complete", "GasKit returned a safe sponsored execution result.");
    els.digest.textContent = executed.digest || "Digest unavailable in this mode";
    if (executed.explorerUrl) {
      els.explorer.href = executed.explorerUrl;
      els.explorer.textContent = "Open explorer";
    }
  } catch (error) {
    const body = error && typeof error === "object" ? error.body : undefined;
    if (body && body.error === "LIVE_TESTNET_UNAVAILABLE") {
      setState("live-testnet-unavailable", "Live testnet unavailable", safeErrorMessage(body));
    } else {
      setState("failed-safe-error", "Failed safely", safeErrorMessage(body));
    }
  } finally {
    els.claim.disabled = !proofdrop.walletAddress;
  }
}

els.connect.addEventListener("click", () => setWallet("0xPROOFDROP_VISITOR"));
els.denied.addEventListener("click", () => setWallet("0xDENIED_PROOFDROP_WALLET"));
els.walletInput.addEventListener("input", (event) => setWallet(event.target.value.trim()));
els.claim.addEventListener("click", claim);
els.reset.addEventListener("click", () => setWallet(""));

setWallet("");
loadHealth().catch(() => {
  setState("failed-safe-error", "Failed safely", "The local ProofDrop API is unavailable.");
});
