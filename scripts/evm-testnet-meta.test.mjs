import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeTestnetName, resolveEvmTestnetMeta } = require("./evm-testnet-meta.js");

describe("evm-testnet-meta helpers", () => {
  it("normalizes known aliases", () => {
    expect(normalizeTestnetName("base")).toBe("base-sepolia");
    expect(normalizeTestnetName("basesepolia")).toBe("base-sepolia");
    expect(normalizeTestnetName("Base Sepolia")).toBe("base-sepolia");
    expect(normalizeTestnetName("polygon")).toBe("polygon-amoy");
    expect(normalizeTestnetName("Polygon Amoy")).toBe("polygon-amoy");
  });

  it("resolves chain metadata", () => {
    expect(resolveEvmTestnetMeta("base-sepolia")).toMatchObject({
      chain: "base",
      chainId: 84532,
      gasSymbol: "ETH",
    });
    expect(resolveEvmTestnetMeta("polygon-amoy")).toMatchObject({
      chain: "polygon",
      chainId: 80002,
      gasSymbol: "POL",
    });
  });
});
