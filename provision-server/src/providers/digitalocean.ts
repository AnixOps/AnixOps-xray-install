import { createHash } from "crypto";
import type { CloudProvider, VPSInfo } from "../provider.js";

export function createDOProvider(apiKey: string): CloudProvider {
  const baseUrl = "https://api.digitalocean.com/v2";

  async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DigitalOcean API error: ${res.status} - ${errText}`);
    }
    return res.json();
  }

  // Compute MD5 fingerprint from public key (DO format)
  function fingerprint(publicKey: string): string {
    return createHash("md5")
      .update(publicKey)
      .digest("hex")
      .replace(/(.{2})(?!$)/g, "$1:");
  }

  // Register SSH key if not already present, return fingerprint
  async function getOrCreateSSHKey(publicKey: string): Promise<string> {
    const fp = fingerprint(publicKey);
    const listRes = await request("/account/keys") as Record<string, unknown>;
    const sshKeys = (listRes.ssh_keys ?? []) as Array<{ fingerprint: string }>;
    const existing = sshKeys.find((k) => k.fingerprint === fp);
    if (existing) return existing.fingerprint;

    const createRes = await request("/account/keys", {
      method: "POST",
      body: JSON.stringify({
        name: "anixops-rental",
        public_key: publicKey.trim(),
      }),
    }) as Record<string, { fingerprint: string }>;
    return createRes.ssh_key.fingerprint;
  }

  return {
    async createServer({ region, plan, sshKey, tag, userData }): Promise<VPSInfo> {
      const body: Record<string, unknown> = {
        name: tag ? `anixops-${tag}` : `anixops-rental-${Date.now()}`,
        region,
        size: plan,
        image: "ubuntu-22-04-x64",
        monitoring: true,
      };

      if (sshKey) {
        const sshKeyFp = await getOrCreateSSHKey(sshKey);
        body.ssh_keys = [sshKeyFp];
      }

      if (userData) {
        body.user_data = userData;
      }

      const data = await request("/droplets", {
        method: "POST",
        body: JSON.stringify(body),
      }) as Record<string, { id: number; status: string; network: { v4: Array<{ type: string; ip_address: string }> } }>;
      const droplet = data.droplet;
      const ip = droplet.network?.v4?.find((n) => n.type === "public")?.ip_address || "";
      return {
        id: String(droplet.id),
        ip,
        status: droplet.status,
      };
    },

    async getServer(id: string): Promise<VPSInfo> {
      const data = await request(`/droplets/${id}`) as Record<string, { status: string; network: { v4: Array<{ type: string; ip_address: string }> } }>;
      const droplet = data.droplet;
      const ip = droplet.network?.v4?.find((n) => n.type === "public")?.ip_address || "";
      return {
        id,
        ip,
        status: droplet.status,
      };
    },

    async deleteServer(id: string): Promise<void> {
      await request(`/droplets/${id}`, { method: "DELETE" });
    },

    async listServersByTag(tag: string): Promise<VPSInfo[]> {
      const data = await request("/droplets?per_page=200") as Record<string, { id: number; name: string; status: string; network: { v4: Array<{ type: string; ip_address: string }> } }[]>;
      const droplets = data.droplets ?? [];
      return droplets
        .filter((d) => d.name === `anixops-${tag}`)
        .map((d) => ({
          id: String(d.id),
          ip: d.network?.v4?.find((n) => n.type === "public")?.ip_address || "",
          status: d.status,
        }));
    },
  };
}
