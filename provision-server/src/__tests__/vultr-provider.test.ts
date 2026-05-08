import { afterEach, describe, expect, it, vi } from "vitest";
import { createVultrProvider } from "../providers/vultr";

describe("Vultr provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends sshkey_id as an array when creating an instance", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });

      if (url.endsWith("/ssh-keys")) {
        return new Response(JSON.stringify({ ssh_keys: [{ id: "ssh-key-id", ssh_key: "ssh-ed25519 AAAA anixops" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/instances")) {
        return new Response(JSON.stringify({
          instance: {
            id: "instance-id",
            main_ip: "203.0.113.10",
            status: "pending",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }));

    const provider = createVultrProvider("test-key");
    await provider.createServer({
      region: "nrt",
      plan: "vhf-1c-1gb",
      sshKey: "ssh-ed25519 AAAA anixops",
      tag: "rental-id",
      userData: "#cloud-config\nruncmd: []\n",
    });

    const createInstanceRequest = requests.find((request) => request.url.endsWith("/instances"));
    expect(createInstanceRequest).toBeTruthy();
    const body = JSON.parse(String(createInstanceRequest?.init?.body));
    expect(body.sshkey_id).toEqual(["ssh-key-id"]);
    expect(body.user_data).toBe(Buffer.from("#cloud-config\nruncmd: []\n", "utf8").toString("base64"));
  });

  it("treats an empty Vultr delete response as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/instances/instance-id") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response("not found", { status: 404 });
    }));

    const provider = createVultrProvider("test-key");
    await expect(provider.deleteServer("instance-id")).resolves.toBeUndefined();
  });
});
