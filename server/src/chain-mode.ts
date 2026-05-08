export type ChainEnvironment = "testnet" | "mainnet";

export function normalizeEmail(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

export function normalizeChainEnvironment(value: string | null | undefined): ChainEnvironment {
  return String(value || "").trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

export function isChainFeatureAllowed(input: {
  chainEnvironment: ChainEnvironment;
  whitelistEmails: string[];
  email: string | null | undefined;
}) {
  if (input.chainEnvironment !== "testnet") {
    return {
      allowed: true,
      allowlistedOnly: false,
      reason: null,
    };
  }

  const email = normalizeEmail(input.email);
  const whitelist = input.whitelistEmails.map((item) => item.toLowerCase());
  if (!email) {
    return {
      allowed: false,
      allowlistedOnly: true,
      reason: "missing_email",
    };
  }
  if (whitelist.includes(email)) {
    return {
      allowed: true,
      allowlistedOnly: true,
      reason: null,
    };
  }
  return {
    allowed: false,
    allowlistedOnly: true,
    reason: "not_allowlisted",
  };
}
