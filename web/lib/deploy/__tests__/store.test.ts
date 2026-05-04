import { describe, it, expect } from "vitest";
import { useDeployStore } from "../store";

describe("deploy store", () => {
  it("starts with default state", () => {
    useDeployStore.getState().reset();
    const state = useDeployStore.getState();
    expect(state.step).toBe(1);
    expect(state.deployMethod).toBeNull();
    expect(state.provider).toBeNull();
    expect(state.protocol).toBeNull();
    expect(state.status).toBe("pending");
    expect(state.steps).toHaveLength(3);
    expect(state.config).toBeNull();
    expect(state.error).toBeNull();
    expect(state.serverIp).toBe("");
    expect(state.sshPort).toBe(22);
    expect(state.sshPassword).toBe("");
  });

  it("resets to default state", () => {
    const store = useDeployStore.getState();
    store.setProvider("vultr");
    store.setRegion("nrt");
    store.setProtocol("vless-reality");
    store.setDeployMethod("ssh");
    store.setServerIp("1.2.3.4");
    store.setSshPassword("test123");
    expect(useDeployStore.getState().provider).toBe("vultr");
    expect(useDeployStore.getState().deployMethod).toBe("ssh");

    store.reset();
    const resetState = useDeployStore.getState();
    expect(resetState.provider).toBeNull();
    expect(resetState.deployMethod).toBeNull();
    expect(resetState.protocol).toBeNull();
    expect(resetState.step).toBe(1);
    expect(resetState.serverIp).toBe("");
    expect(resetState.sshPassword).toBe("");
  });

  it("updates step status and timestamps", () => {
    useDeployStore.getState().reset();
    // Capture timestamp BEFORE the store captures its own Date.now()
    const before = Date.now() - 1;

    useDeployStore.getState().updateStep({ stepId: "provision", status: "running" });
    const steps = useDeployStore.getState().steps;
    const runningStep = steps.find((s) => s.id === "provision")!;
    expect(runningStep.status).toBe("running");
    expect(runningStep.startedAt).toBeGreaterThanOrEqual(before);
    expect(runningStep.finishedAt).toBeUndefined();
  });

  it("sets finishedAt when step succeeds", () => {
    useDeployStore.getState().reset();
    const before = Date.now() - 1;

    useDeployStore.getState().updateStep({ stepId: "provision", status: "running" });
    useDeployStore.getState().updateStep({ stepId: "provision", status: "success" });

    const doneStep = useDeployStore.getState().steps.find((s) => s.id === "provision")!;
    expect(doneStep.status).toBe("success");
    expect(doneStep.finishedAt).toBeGreaterThanOrEqual(before);
  });

  it("tracks deployment status transitions", () => {
    useDeployStore.getState().reset();
    useDeployStore.getState().setStatus("running");
    expect(useDeployStore.getState().status).toBe("running");
    useDeployStore.getState().setStatus("success");
    expect(useDeployStore.getState().status).toBe("success");
    useDeployStore.getState().setStatus("failed");
    expect(useDeployStore.getState().status).toBe("failed");
  });

  it("sets config on success", () => {
    useDeployStore.getState().reset();
    const config = { protocol: "vless-reality", ip: "1.2.3.4", port: "443" };
    useDeployStore.getState().setConfig(config);
    expect(useDeployStore.getState().config).toEqual(config);
  });

  it("sets error message on failure", () => {
    useDeployStore.getState().reset();
    useDeployStore.getState().setError("VPS creation failed");
    expect(useDeployStore.getState().error).toBe("VPS creation failed");
  });
});
