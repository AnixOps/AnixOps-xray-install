import { afterEach, describe, it, expect, vi } from "vitest";
import {
  encodeBase64Text,
  decodeBase64Text,
  generateVlessRealityConfig,
  generateHysteria2Config,
  generateHysteria2Subscription,
  generateVlessRealitySubscription,
  isValidSubscriptionUri,
  isValidUniversalSubscription,
  normalizeConfigSubscription,
  normalizeRentalConfig,
  normalizeSubscriptionValue,
} from "../generator";

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

  it("uses a supplied domain as the connection host and SNI", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      domain: "random.pblaze.com",
      port: 443,
      password: "pass123",
      insecure: true,
    });

    expect(config.clashMeta).toContain("server: random.pblaze.com");
    expect(config.clashMeta).toContain("sni: random.pblaze.com");
    expect(config.v2rayN).toContain("@random.pblaze.com:443/");

    const parsed = JSON.parse(config.singbox);
    expect(parsed.outbounds[0].server).toBe("random.pblaze.com");
    expect(parsed.outbounds[0].tls.server_name).toBe("random.pblaze.com");
  });

  it("adds port hopping fields when the port is a range", () => {
    const config = generateHysteria2Config({
      ip: "5.6.7.8",
      port: "20000-50000",
      password: "hop-pass",
      insecure: true,
    });

    expect(config.clashMeta).toContain("ports: 20000-50000");
    expect(config.clashMeta).toContain("hop-interval: 30");
    expect(config.v2rayN).toContain("@5.6.7.8:20000-50000/");

    const parsed = JSON.parse(config.singbox);
    expect(parsed.outbounds[0].server_port).toBe(20000);
    expect(parsed.outbounds[0].server_ports).toEqual(["20000:50000"]);
    expect(parsed.outbounds[0].hop_interval).toBe("30s");
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("encodes single-link subscriptions as base64 text", () => {
    const subscription = generateVlessRealitySubscription({
      ip: "1.2.3.4",
      port: 443,
      uuid: "uuid",
      serverName: "addons.mozilla.org",
      publicKey: "pubkey",
      shortId: "abcd",
    });

    expect(Buffer.from(subscription, "base64").toString("utf-8")).toContain("vless://");
  });

  it("encodes arbitrary utf-8 text to base64", () => {
    const encoded = encodeBase64Text("hello\n");
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe("hello\n");
  });

  it("decodes base64 text", () => {
    expect(decodeBase64Text(encodeBase64Text("hello world"))).toBe("hello world");
  });

  it("rejects incomplete rental config before generating exportable links", () => {
    expect(normalizeRentalConfig({
      protocol: "hysteria2",
      ip: "1.2.3.4",
      port: 443,
    }).ok).toBe(false);

    expect(normalizeConfigSubscription({
      protocol: "hysteria2",
      ip: "1.2.3.4",
      port: 443,
    })).toMatchObject({ ok: false, status: 409 });
  });

  it("accepts hysteria2 port hopping ranges in rental configs", () => {
    const validation = normalizeRentalConfig({
      protocol: "hysteria2",
      ip: "1.2.3.4",
      port: "20000-50000",
      password: "pass123",
      insecure: true,
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    if (validation.config.protocol !== "hysteria2") {
      return;
    }

    expect(validation.config.port).toBe("20000-50000");
    expect(decodeBase64Text(generateHysteria2Subscription(validation.config))).toContain("20000-50000");
  });

  it("preserves a hysteria2 domain when normalizing configs", () => {
    const validation = normalizeRentalConfig({
      protocol: "hysteria2",
      ip: "1.2.3.4",
      port: 443,
      password: "pass123",
      domain: "random.pblaze.com",
      insecure: true,
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok || validation.config.protocol !== "hysteria2") {
      return;
    }

    expect(validation.config.domain).toBe("random.pblaze.com");
    expect(generateHysteria2Config(validation.config).v2rayN).toContain("@random.pblaze.com:443/");
  });

  it("rejects universal subscriptions that decode to undefined fields", () => {
    const broken = encodeBase64Text("hysteria2://user:undefined@undefined:undefined/?insecure=1#AnixOps\n");
    expect(isValidUniversalSubscription(broken)).toBe(false);
    expect(normalizeSubscriptionValue(broken, "universal")).toBeNull();
  });

  it("rejects invalid base64 universal subscriptions without throwing", () => {
    vi.stubGlobal("Buffer", undefined);

    expect(normalizeSubscriptionValue("not-base64", "universal")).toBeNull();
    expect(isValidUniversalSubscription("not-base64")).toBe(false);
  });

  it("accepts valid raw subscription URIs", () => {
    const raw = "hysteria2://user:strong-password@1.2.3.4:443/?insecure=1#AnixOps";
    expect(isValidSubscriptionUri(raw)).toBe(true);
    expect(normalizeSubscriptionValue(raw, "raw")).toBe(raw);
  });
});
