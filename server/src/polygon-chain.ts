// Backward-compatible shim for deployments where renamed source files may still exist remotely.
export {
  buildExpectedTokenAmount,
  sendEvmAnchorTransaction as sendPolygonAnchorTransaction,
  verifyEvmTopupTransaction as verifyPolygonTopupTransaction,
} from "./evm-chain.js";
