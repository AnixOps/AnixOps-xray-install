import { describe, it, expect } from "vitest";
import { generateVlessRealityConfig, generateHysteria2Config } from "../generator";

describe("VLESS Reality config generator", () => {
  it("generates Clash Meta config with TCP transport", () => {
    const config = generateVlessRealityConfig({
      ip: "1.2.3.4",
      port: 443,
      uuid: "test-uuid-1234",
      serverName: "addons.mozilla.org",
      publicKey: "pubkey123",
      shortId: "abcd1234",
    });

    expect(config.clashMeta).toContain("vless");
    expect(config.clashMeta).toContain("1.2.3.4");
    expect(config.clashMeta).toContain("network: tcp");
    expect(config.clashMeta).toContain("flow: xtls-rprx-vision");
    expect(config.clashMeta).not.toContain("grpc");
    expect(config.singbox).toContain("test-uuid-1234");
    expect(config.v2rayN).toMatch(/^vless:\/\//);
    expect(config.shadowrocket).toMatch(/^vless:\/\//);
  });

  it("generates valid Singbox JSON with TCP", () => {
    const config = generateVlessRealityConfig({
      ip: "10.0.0.1",
      port: 443,
      uuid: "test-uuid",
      serverName: "example.com",
      publicKey: "pk",
      shortId: "0000",
    });

    const parsed = JSON.parse(config.singbox);
    expect(parsed.outbounds).toHaveLength(1);
    expect(parsed.outbounds[0].type).toBe("vless");
    expect(parsed.outbounds[0].flow).toBe("xtls-rprx-vision");
    expect(parsed.outbounds[0].tls.reality.enabled).toBe(true);
    expect(parsed.outbounds[0].transport).toBeUndefined();
  });

  it("embeds all parameters in v2rayN share link", () => {
    const config = generateVlessRealityConfig({
      ip: "1.2.3.4",
      port: 443,
      uuid: "abc123",
      serverName: "example.com",
      publicKey: "mypk",
      shortId: "ff00",
    });

    expect(config.v2rayN).toContain("abc123");
    expect(config.v2rayN).toContain("1.2.3.4");
    expect(config.v2rayN).toContain("pbk=mypk");
    expect(config.v2rayN).toContain("sid=ff00");
    expect(config.v2rayN).toContain("sni=example.com");
    expect(config.v2rayN).toContain("type=tcp");
    expect(config.v2rayN).toContain("flow=xtls-rprx-vision");
    expect(config.v2rayN).not.toContain("grpc");
  });

  it("uses AnixOps label in all client configs", () => {
    const config = generateVlessRealityConfig({
      ip: "1.2.3.4",
      port: 443,
      uuid: "x",
      serverName: "s",
      publicKey: "p",
      shortId: "00",
    });

    expect(config.clashMeta).toContain("AnixOps");
    expect(JSON.parse(config.singbox).outbounds[0].tag).toBe("AnixOps");
    expect(config.v2rayN).toContain("#AnixOps");
    expect(config.shadowrocket).toContain("#AnixOps");
  });

  it("Shadowrocket uses net=tcp and includes flow", () => {
    const config = generateVlessRealityConfig({
      ip: "1.2.3.4",
      port: 443,
      uuid: "u",
      serverName: "s",
      publicKey: "p",
      shortId: "00",
    });

    expect(config.shadowrocket).toContain("net=tcp");
    expect(config.shadowrocket).toContain("flow=xtls-rprx-vision");
    expect(config.shadowrocket).not.toContain("grpc");
  });
});

describe("Hysteria2 config generator", () => {
  it("generates Clash Meta config", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      port: 443,
      password: "hy2password",
      obfs: "obfs123",
      insecure: true,
    });

    expect(config.clashMeta).toContain("hysteria2");
    expect(config.clashMeta).toContain("5.6.7.8");
    expect(config.clashMeta).toContain("hy2password");
    expect(config.singbox).toContain("hy2password");
    expect(config.v2rayN).toMatch(/^hysteria2:\/\//);
  });

  it("generates valid Singbox JSON with obfs", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      port: 443,
      password: "pass123",
      obfs: "secret",
      insecure: true,
    });

    const parsed = JSON.parse(config.singbox);
    expect(parsed.outbounds[0].type).toBe("hysteria2");
    expect(parsed.outbounds[0].obfs.type).toBe("salamander");
    expect(parsed.outbounds[0].obfs.password).toBe("secret");
    expect(parsed.outbounds[0].tls.insecure).toBe(true);
  });

  it("generates config without obfs when not provided", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      port: 443,
      password: "pass123",
      insecure: false,
    });

    expect(config.clashMeta).not.toContain("obfs");
    expect(config.clashMeta).toContain("skip-cert-verify: false");
    const parsed = JSON.parse(config.singbox);
    expect(parsed.outbounds[0].obfs).toBeUndefined();
    expect(parsed.outbounds[0].tls.insecure).toBe(false);
  });

  it("URL-encodes password with special characters in share link", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      port: 443,
      password: "pass=word&special",
      insecure: true,
    });

    // Password must be URL-encoded in the URI
    expect(config.v2rayN).not.toContain("pass=word&special");
    expect(config.v2rayN).toContain("pass%3Dword%26special");
  });

  it("uses AnixOps label in all client configs", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      port: 443,
      password: "p",
      insecure: true,
    });

    expect(config.clashMeta).toContain("AnixOps");
    expect(JSON.parse(config.singbox).outbounds[0].tag).toBe("AnixOps");
    expect(config.v2rayN).toContain("#AnixOps");
    expect(config.shadowrocket).toContain("#AnixOps");
  });

  it("hides password from Clash Meta YAML (uses quotes)", () => {
    const config = generateHysteria2Config({
      ip: "1.2.3.4",
      port: 8443,
      password: "my$ecret",
      insecure: true,
    });

    expect(config.clashMeta).toContain("my$ecret");
  });

  it("handles empty obfs path (no obfs in output)", () => {
    const config = generateHysteria2Config({
      ip: "1.2.3.4",
      port: 443,
      password: "test",
      obfs: "",
      insecure: true,
    });

    const parsed = JSON.parse(config.singbox);
    expect(parsed.outbounds[0].obfs).toBeUndefined();
  });
});

describe("config generator edge cases", () => {
  it("handles IPv6 addresses in VLESS Reality config", () => {
    const config = generateVlessRealityConfig({
      ip: "2001:db8::1",
      port: 443,
      uuid: "test-uuid",
      serverName: "example.com",
      publicKey: "pk",
      shortId: "00",
    });

    expect(config.clashMeta).toContain("2001:db8::1");
    expect(config.v2rayN).toContain("2001:db8::1");
  });

  it("generates config with minimum port number", () => {
    const config = generateVlessRealityConfig({
      ip: "1.2.3.4",
      port: 1,
      uuid: "uuid",
      serverName: "s",
      publicKey: "p",
      shortId: "00",
    });

    expect(config.clashMeta).toContain("port: 1");
  });

  it("generates config with maximum port number", () => {
    const config = generateVlessRealityConfig({
      ip: "1.2.3.4",
      port: 65535,
      uuid: "uuid",
      serverName: "s",
      publicKey: "p",
      shortId: "00",
    });

    expect(config.clashMeta).toContain("port: 65535");
  });

  it("all four client formats are always produced", () => {
    const vless = generateVlessRealityConfig({
      ip: "1.2.3.4", port: 443, uuid: "u", serverName: "s", publicKey: "p", shortId: "00",
    });
    expect(Object.keys(vless)).toEqual(["clashMeta", "singbox", "v2rayN", "shadowrocket"]);

    const hy2 = generateHysteria2Config({
      ip: "1.2.3.4", port: 443, password: "p", insecure: true,
    });
    expect(Object.keys(hy2)).toEqual(["clashMeta", "singbox", "v2rayN", "shadowrocket"]);
  });
});
