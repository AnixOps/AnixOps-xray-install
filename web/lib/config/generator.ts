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
  port: number | string;
  password: string;
  obfs?: string;
  domain?: string;
  sni?: string;
  pinSHA256?: string;
  insecure: boolean;
};

export type NormalizedRentalConfig = NormalizedVlessRealityConfig | NormalizedHysteria2Config;

export type RentalConfigValidation =
  | { ok: true; config: NormalizedRentalConfig }
  | { ok: false; status: 202 | 409; error: string };

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePortNumber(value: unknown) {
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

function normalizeHysteria2PortSpec(value: unknown): number | string | null {
  if (typeof value === "number") {
    return normalizePortNumber(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.split(",").map((segment) => segment.trim());
  if (segments.length === 0 || segments.some((segment) => !segment)) {
    return null;
  }

  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      const port = normalizePortNumber(Number(segment));
      if (port === null) {
        return null;
      }
      normalizedSegments.push(String(port));
      continue;
    }

    const rangeMatch = segment.match(/^(\d+)-(\d+)$/);
    if (!rangeMatch) {
      return null;
    }

    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 1
      || end > 65535
      || start > end
    ) {
      return null;
    }

    normalizedSegments.push(`${start}-${end}`);
  }

  if (normalizedSegments.length === 1 && /^\d+$/.test(normalizedSegments[0])) {
    return Number(normalizedSegments[0]);
  }

  return normalizedSegments.join(",");
}

function formatHysteria2PortSpec(port: number | string) {
  return typeof port === "number" ? String(port) : port.trim();
}

function getHysteria2PortSegments(port: number | string) {
  return formatHysteria2PortSpec(port)
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function formatHysteria2SingboxPortSegment(segment: string) {
  const rangeMatch = segment.match(/^(\d+)-(\d+)$/);
  if (!rangeMatch) {
    return segment;
  }

  return `${Number(rangeMatch[1])}:${Number(rangeMatch[2])}`;
}

function getHysteria2SingboxServerPorts(port: number | string) {
  return getHysteria2PortSegments(port).map(formatHysteria2SingboxPortSegment);
}

function getHysteria2PrimaryPort(port: number | string) {
  const [first] = getHysteria2PortSegments(port);
  if (!first) {
    return 0;
  }

  const match = first.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return 0;
  }

  return Number(match[1]);
}

function hasHysteria2PortHopping(port: number | string) {
  const portSpec = formatHysteria2PortSpec(port);
  return portSpec.includes("-") || portSpec.includes(",");
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

function normalizePinSHA256(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const stripped = normalized
    .replace(/^sha256\//, "")
    .replace(/[:-]/g, "");

  return /^[0-9a-f]{64}$/.test(stripped) ? stripped : null;
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
  return /^(vless|hysteria2|hy2):\/\/\S+$/i.test(candidate);
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

  if (!protocol || !ip) {
    return { ok: false, status: 409, error: "Deployment is not ready yet." };
  }

  if (protocol === "vless-reality") {
    const port = normalizePortNumber((rawConfig as Record<string, unknown>).port);
    const uuid = normalizeString((rawConfig as Record<string, unknown>).uuid);
    const serverName = normalizeString((rawConfig as Record<string, unknown>).serverName);
    const publicKey = normalizeString((rawConfig as Record<string, unknown>).publicKey);
    const shortId = normalizeString((rawConfig as Record<string, unknown>).shortId);

    if (port === null || !uuid || !serverName || !publicKey || !shortId) {
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
    const port = normalizeHysteria2PortSpec((rawConfig as Record<string, unknown>).port);
    const password = normalizeString((rawConfig as Record<string, unknown>).password);
    if (!password || port === null) {
      return { ok: false, status: 409, error: "Deployment is not ready yet." };
    }

    const obfs = normalizeString((rawConfig as Record<string, unknown>).obfs) || undefined;
    const domain = normalizeString((rawConfig as Record<string, unknown>).domain) || undefined;
    const sni = normalizeString((rawConfig as Record<string, unknown>).sni) || domain || undefined;
    const pinSHA256 = normalizePinSHA256((rawConfig as Record<string, unknown>).pinSHA256) || undefined;

    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        password,
        insecure: normalizeBoolean((rawConfig as Record<string, unknown>).insecure, true),
        ...(obfs ? { obfs } : {}),
        ...(domain ? { domain } : {}),
        ...(sni ? { sni } : {}),
        ...(pinSHA256 ? { pinSHA256 } : {}),
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
  port: number | string;
  password: string;
  obfs?: string;
  domain?: string;
  sni?: string;
  pinSHA256?: string;
  insecure?: boolean;
}) {
  const { ip, port, password, obfs, domain, sni, pinSHA256, insecure = true } = params;
  const host = domain?.trim() || ip;
  const tlsServerName = sni?.trim() || domain?.trim() || "";
  const tlsPinSHA256 = normalizePinSHA256(pinSHA256);
  const portSpec = formatHysteria2PortSpec(port);
  const portHopping = hasHysteria2PortHopping(port);
  const primaryPort = getHysteria2PrimaryPort(port);
  const hopPorts = getHysteria2SingboxServerPorts(port);

  const uriParams = new URLSearchParams({
    insecure: insecure ? "1" : "0",
  });
  if (tlsServerName) {
    uriParams.set("sni", tlsServerName);
  }
  if (tlsPinSHA256) {
    uriParams.set("pinSHA256", tlsPinSHA256);
  }
  if (obfs) {
    uriParams.set("obfs", "salamander");
    uriParams.set("obfs-password", obfs);
  }

  const uri = `hysteria2://${encodeURIComponent(password)}@${host}:${portSpec}/?${uriParams.toString()}#AnixOps`;
  const clashHopBlock = portHopping
    ? `    ports: ${portSpec}\n    hop-interval: 30\n`
    : "";
  const clashSniBlock = tlsServerName ? `    sni: ${tlsServerName}\n` : "";
  const clashPinBlock = tlsPinSHA256 ? `    pinSHA256: ${tlsPinSHA256}\n` : "";

  return {
    clashMeta: `proxies:
  - name: AnixOps
    type: hysteria2
    server: ${host}
    port: ${primaryPort}
${clashHopBlock}    password: "${password}"
    udp: true
${clashSniBlock}${clashPinBlock}    skip-cert-verify: ${insecure}${obfs ? `
    obfs: salamander
    obfs-password: "${obfs}"` : ""}`,

    singbox: JSON.stringify({
      outbounds: [{
        type: "hysteria2",
        tag: "AnixOps",
        server: host,
        server_port: primaryPort,
        ...(portHopping ? {
          server_ports: hopPorts,
          hop_interval: "30s",
        } : {}),
        password,
        tls: {
          enabled: true,
          insecure,
          ...(tlsServerName ? { server_name: tlsServerName } : {}),
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
  port: number | string;
  password: string;
  obfs?: string;
  domain?: string;
  insecure?: boolean;
}) {
  const single = generateHysteria2Config(params).v2rayN;
  return encodeBase64Text(`${single}\n`);
}
