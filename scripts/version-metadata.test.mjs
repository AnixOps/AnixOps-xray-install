import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildVersionMetadata,
  parseArgs,
} = require("./version-metadata.js");

describe("version metadata helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs(["--file", "versions.json", "--dry-run"])).toEqual({
      file: "versions.json",
      dryRun: true,
    });
  });

  it("builds synced version metadata with a new commit", () => {
    const result = buildVersionMetadata(
      {
        frontend: "0.1.0",
        backend: "1.0.0",
        commit: "old1234",
      },
      "new5678",
    );

    expect(result).toEqual({
      frontend: "0.1.0",
      backend: "1.0.0",
      commit: "new5678",
    });
  });
});
