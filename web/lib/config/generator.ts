// VLESS Reality config generators (TCP transport + xtls-rprx-vision flow)
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
