// VLESS Reality config generators (TCP transport + xtls-rprx-vision flow)
export function encodeBase64Text(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeBase64Text(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf-8");
  }

  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

type SubscriptionFormat = "universal" | "raw";

export type NormalizedVlessRealityConfig = {
  protocol: "vless-reality";
  ip: string;
  port: number;
  uuid: string;
  serverName: string;
  publicKey: string;
  shortId: string;
};

export type NormalizedHysteria2Config = {
  protocol: "hysteria2";
  ip: string;
  port: number;
  password: string;
  obfs?: string;
  insecure: boolean;
};

export type NormalizedRentalConfig = NormalizedVlessRealityConfig | NormalizedHysteria2Config;

export type RentalConfigValidation =
  | { ok: true; config: NormalizedRentalConfig }
  | { ok: false; status: 202 | 409; error: string };

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePort(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 && String(parsed) === value.trim()) {
      return parsed;
    }
  }

  return null;
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeSubscriptionCandidate(value: string) {
  return value.trim();
}

export function isValidSubscriptionUri(value: string) {
  const candidate = normalizeSubscriptionCandidate(value);
  if (!candidate) {
    return false;
  }
  if (candidate.includes("undefined")) {
    return false;
  }
  return /^(vless|hysteria2):\/\/\S+$/i.test(candidate);
}

export function normalizeSubscriptionValue(value: string | null | undefined, format: SubscriptionFormat = "universal") {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedInput = value.trim();
  if (!normalizedInput) {
    return null;
  }

  let candidate: string;
  try {
    candidate = format === "universal"
      ? decodeBase64Text(normalizedInput)
      : normalizedInput;
  } catch {
    return null;
  }

  return isValidSubscriptionUri(candidate) ? normalizedInput : null;
}

export function isValidUniversalSubscription(value: string) {
  return normalizeSubscriptionValue(value, "universal") !== null;
}

export function normalizeRentalConfig(rawConfig: unknown): RentalConfigValidation {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return { ok: false, status: 409, error: "Deployment is not ready yet." };
  }

  const protocol = normalizeString((rawConfig as Record<string, unknown>).protocol);
  const ip = normalizeString((rawConfig as Record<string, unknown>).ip);
  const port = normalizePort((rawConfig as Record<string, unknown>).port);

  if (!protocol || !ip || port === null) {
    return { ok: false, status: 409, error: "Deployment is not ready yet." };
  }

  if (protocol === "vless-reality") {
    const uuid = normalizeString((rawConfig as Record<string, unknown>).uuid);
    const serverName = normalizeString((rawConfig as Record<string, unknown>).serverName);
    const publicKey = normalizeString((rawConfig as Record<string, unknown>).publicKey);
    const shortId = normalizeString((rawConfig as Record<string, unknown>).shortId);

    if (!uuid || !serverName || !publicKey || !shortId) {
      return { ok: false, status: 409, error: "Deployment is not ready yet." };
    }

    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        uuid,
        serverName,
        publicKey,
        shortId,
      },
    };
  }

  if (protocol === "hysteria2") {
    const password = normalizeString((rawConfig as Record<string, unknown>).password);
    if (!password) {
      return { ok: false, status: 409, error: "Deployment is not ready yet." };
    }

    const obfs = normalizeString((rawConfig as Record<string, unknown>).obfs) || undefined;

    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        password,
        insecure: normalizeBoolean((rawConfig as Record<string, unknown>).insecure, true),
        ...(obfs ? { obfs } : {}),
      },
    };
  }

  return { ok: false, status: 409, error: "Deployment is not ready yet." };
}

export function normalizeConfigSubscription(rawConfig: unknown, format: SubscriptionFormat = "universal") {
  const validation = normalizeRentalConfig(rawConfig);
  if (!validation.ok) {
    return validation;
  }

  const payload = validation.config.protocol === "vless-reality"
    ? generateVlessRealitySubscription(validation.config)
    : generateHysteria2Subscription(validation.config);

  const subscription = format === "raw"
    ? normalizeSubscriptionValue(decodeBase64Text(payload), "raw")
    : normalizeSubscriptionValue(payload, "universal");

  if (!subscription) {
    return { ok: false as const, status: 409 as const, error: "Deployment is not ready yet." };
  }

  return { ok: true as const, subscription };
}

export function generateVlessRealityConfig(params: {
  ip: string;
  port: number;
  uuid: string;
  serverName: string;
  publicKey: string;
  shortId: string;
}) {
  const { ip, port, uuid, serverName, publicKey, shortId } = params;

  return {
    clashMeta: `proxies:
  - name: AnixOps
    type: vless
    server: ${ip}
    port: ${port}
    uuid: ${uuid}
    network: tcp
    tls: true
    udp: true
    flow: xtls-rprx-vision
    servername: ${serverName}
    reality-opts:
      public-key: ${publicKey}
      short-id: ${shortId}`,

    singbox: JSON.stringify({
      outbounds: [{
        type: "vless",
        tag: "AnixOps",
        server: ip,
        server_port: port,
        uuid,
        flow: "xtls-rprx-vision",
        tls: {
          enabled: true,
          server_name: serverName,
          utls: { enabled: true, fingerprint: "chrome" },
          reality: { enabled: true, public_key: publicKey, short_id: shortId },
        },
      }],
    }, null, 2),

    v2rayN: (() => {
      const sp = new URLSearchParams({
        encryption: "none",
        security: "reality",
        type: "tcp",
        sni: serverName,
        pbk: publicKey,
        sid: shortId,
        fp: "chrome",
        flow: "xtls-rprx-vision",
      });
      return `vless://${uuid}@${ip}:${port}?${sp.toString()}#AnixOps`;
    })(),

    shadowrocket: `vless://${uuid}@${ip}:${port}?tls=1&fp=chrome&pbk=${publicKey}&sid=${shortId}&sni=${serverName}&net=tcp&flow=xtls-rprx-vision#AnixOps`,
  };
}

export function generateVlessRealitySubscription(params: {
  ip: string;
  port: number;
  uuid: string;
  serverName: string;
  publicKey: string;
  shortId: string;
}) {
  const single = generateVlessRealityConfig(params).v2rayN;
  return encodeBase64Text(`${single}\n`);
}

// Hysteria2 config generators
export function generateHysteria2Config(params: {
  ip: string;
  port: number;
  password: string;
  obfs?: string;
  insecure?: boolean;
}) {
  const { ip, port, password, obfs, insecure = true } = params;

  const uriParams = new URLSearchParams({
    insecure: insecure ? "1" : "0",
  });
  if (obfs) {
    uriParams.set("obfs", "salamander");
    uriParams.set("obfs-password", obfs);
  }

  const uri = `hysteria2://user:${encodeURIComponent(password)}@${ip}:${port}/?${uriParams.toString()}#AnixOps`;

  return {
    clashMeta: `proxies:
  - name: AnixOps
    type: hysteria2
    server: ${ip}
    port: ${port}
    password: "${password}"
    udp: true
    sni: ${ip}
    skip-cert-verify: ${insecure}${obfs ? `
    obfs: salamander
    obfs-password: "${obfs}"` : ""}`,

    singbox: JSON.stringify({
      outbounds: [{
        type: "hysteria2",
        tag: "AnixOps",
        server: ip,
        server_port: port,
        password,
        tls: {
          enabled: true,
          insecure,
          server_name: ip,
        },
        ...(obfs ? { obfs: { type: "salamander", password: obfs } } : {}),
      }],
    }, null, 2),

    v2rayN: uri,
    shadowrocket: uri,
  };
}

export function generateHysteria2Subscription(params: {
  ip: string;
  port: number;
  password: string;
  obfs?: string;
  insecure?: boolean;
}) {
  const single = generateHysteria2Config(params).v2rayN;
  return encodeBase64Text(`${single}\n`);
}
