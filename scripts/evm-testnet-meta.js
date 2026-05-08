const TESTNETS = {
  "polygon-amoy": {
    chain: "polygon",
    networkName: "polygon-amoy",
    chainId: 80002,
    rpcUrl: "https://rpc-amoy.polygon.technology",
    gasSymbol: "POL",
    explorer: "https://amoy.polygonscan.com/",
  },
  "base-sepolia": {
    chain: "base",
    networkName: "base-sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    gasSymbol: "ETH",
    explorer: "https://sepolia.basescan.org/",
  },
};

function normalizeTestnetName(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const compact = normalized.replace(/[\s_]+/g, "-");
  if (normalized === "base" || normalized === "base-sepolia" || normalized === "basesepolia") {
    return "base-sepolia";
  }
  if (compact === "base-sepolia") {
    return "base-sepolia";
  }
  if (normalized === "polygon" || normalized === "polygon-amoy" || normalized === "amoy") {
    return "polygon-amoy";
  }
  if (compact === "polygon-amoy") {
    return "polygon-amoy";
  }
  return "base-sepolia";
}

function resolveEvmTestnetMeta(value = "") {
  return TESTNETS[normalizeTestnetName(value)];
}

module.exports = {
  TESTNETS,
  normalizeTestnetName,
  resolveEvmTestnetMeta,
};
