import type { CloudProvider, VPSInfo } from "../provider.js";

export function createVultrProvider(apiKey: string): CloudProvider {
  const baseUrl = "https://api.vultr.com/v2";

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
      throw new Error(`Vultr API error: ${res.status} - ${errText}`);
    }
    if (res.status === 204) {
      return {};
    }
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : {};
  }

  // Register SSH key if not already present, return key ID
  async function getOrCreateSSHKeyId(publicKey: string): Promise<string> {
    const listRes = await request("/ssh-keys") as Record<string, unknown>;
    const sshKeys = (listRes.ssh_keys ?? []) as Array<{ id: string; ssh_key: string }>;
    const existing = sshKeys.find((k) => k.ssh_key === publicKey.trim());
    if (existing) return existing.id;

    const createRes = await request("/ssh-keys", {
      method: "POST",
      body: JSON.stringify({
        name: "anixops-rental",
        ssh_key: publicKey.trim(),
      }),
    }) as Record<string, { id: string }>;
    return createRes.ssh_key.id;
  }

  return {
    async createServer({ region, plan, sshKey, tag, userData }): Promise<VPSInfo> {
      const body: Record<string, unknown> = {
        region,
        plan,
        os_id: 1743, // Ubuntu 22.04
        label: tag ? `anixops-${tag}` : `anixops-rental-${Date.now()}`,
      };

      if (sshKey) {
        const sshKeyId = await getOrCreateSSHKeyId(sshKey);
        body.sshkey_id = [sshKeyId];
      }

      if (userData) {
        body.user_data = Buffer.from(userData, "utf8").toString("base64");
      }

      const data = await request("/instances", { method: "POST", body: JSON.stringify(body) }) as Record<string, { id: string; main_ip: string; status: string }>;
      return {
        id: data.instance.id,
        ip: data.instance.main_ip,
        status: data.instance.status,
      };
    },

    async getServer(id: string): Promise<VPSInfo> {
      const data = await request(`/instances/${id}`) as Record<string, { main_ip: string; status: string }>;
      return {
        id,
        ip: data.instance.main_ip,
        status: data.instance.status,
      };
    },

    async deleteServer(id: string): Promise<void> {
      await request(`/instances/${id}`, { method: "DELETE" });
    },

    async listServersByTag(tag: string): Promise<VPSInfo[]> {
      const data = await request("/instances") as Record<string, { id: string; main_ip: string; status: string; label: string }[]>;
      const instances = data.instances ?? [];
      return instances
        .filter((i) => i.label === `anixops-${tag}`)
        .map((i) => ({ id: i.id, ip: i.main_ip, status: i.status }));
    },
  };
}
