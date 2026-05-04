import { create } from "zustand";
import type {
  CloudProvider,
  Protocol,
  DeployStep,
  DeployStatus,
  ProgressEvent,
  AppMode,
  RentalPlan,
  RentalStatus,
} from "@/lib/deploy/types";

interface DeployState {
  mode: AppMode | null;
  // Self-hosted
  step: number;
  deployMethod: "api" | "ssh" | null;
  provider: CloudProvider | null;
  region: string;
  plan: string;
  apiKey: string;
  // SSH direct connect
  serverIp: string;
  sshPort: number;
  sshPassword: string;
  cleanupMode: "duration" | "datetime";
  cleanupHours: string;
  cleanupAtInput: string;
  // Shared
  dnsToken: string;
  domain: string;
  protocol: Protocol | null;
  // Shared
  deployId: string | null;
  status: DeployStatus;
  steps: DeployStep[];
  config: Record<string, string> | null;
  error: string | null;
  // Rental
  rentalPlan: RentalPlan | null;
  rentalStatus: RentalStatus | null;
  rentalId: string | null;
  remainingMinutes: number;
  // Actions
  setMode: (mode: AppMode) => void;
  setStep: (step: number) => void;
  setDeployMethod: (method: "api" | "ssh") => void;
  setProvider: (provider: CloudProvider | null) => void;
  setRegion: (region: string) => void;
  setPlan: (plan: string) => void;
  setApiKey: (key: string) => void;
  setServerIp: (ip: string) => void;
  setSshPort: (port: number) => void;
  setSshPassword: (password: string) => void;
  setCleanupMode: (mode: "duration" | "datetime") => void;
  setCleanupHours: (hours: string) => void;
  setCleanupAtInput: (value: string) => void;
  setDnsToken: (token: string) => void;
  setDomain: (domain: string) => void;
  setProtocol: (proto: Protocol) => void;
  setDeployId: (id: string) => void;
  setStatus: (status: DeployStatus) => void;
  updateStep: (event: ProgressEvent) => void;
  setConfig: (config: Record<string, string>) => void;
  setError: (error: string | null) => void;
  setRentalPlan: (plan: RentalPlan) => void;
  setRentalStatus: (status: RentalStatus) => void;
  setRentalId: (id: string) => void;
  setRemainingMinutes: (min: number) => void;
  reset: () => void;
}

const defaultSteps: DeployStep[] = [
  { id: "provision", label: "selfhosted.step.provision", status: "pending" },
  { id: "deploy", label: "selfhosted.step.deploy", status: "pending" },
  { id: "config", label: "selfhosted.step.config", status: "pending" },
];

export const useDeployStore = create<DeployState>((set) => ({
  mode: null,
  step: 1,
  deployMethod: null,
  provider: null,
  region: "",
  plan: "",
  apiKey: "",
  serverIp: "",
  sshPort: 22,
  sshPassword: "",
  cleanupMode: "duration",
  cleanupHours: "24",
  cleanupAtInput: "",
  dnsToken: "",
  domain: "",
  protocol: null,
  deployId: null,
  status: "pending",
  steps: defaultSteps,
  config: null,
  error: null,
  rentalPlan: null,
  rentalStatus: null,
  rentalId: null,
  remainingMinutes: 0,

  setMode: (mode) => set({ mode }),
  setStep: (step) => set({ step }),
  setDeployMethod: (deployMethod) => set({ deployMethod }),
  setProvider: (provider) => set({ provider }),
  setRegion: (region) => set({ region }),
  setPlan: (plan) => set({ plan }),
  setApiKey: (apiKey) => set({ apiKey }),
  setServerIp: (serverIp) => set({ serverIp }),
  setSshPort: (sshPort) => set({ sshPort }),
  setSshPassword: (sshPassword) => set({ sshPassword }),
  setCleanupMode: (cleanupMode) => set({ cleanupMode }),
  setCleanupHours: (cleanupHours) => set({ cleanupHours }),
  setCleanupAtInput: (cleanupAtInput) => set({ cleanupAtInput }),
  setDnsToken: (dnsToken) => set({ dnsToken }),
  setDomain: (domain) => set({ domain }),
  setProtocol: (protocol) => set({ protocol }),
  setDeployId: (deployId) => set({ deployId }),
  setStatus: (status) => set({ status }),
  updateStep: ({ stepId, status, message }) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              status,
              message,
              startedAt: status === "running" ? Date.now() : s.startedAt,
              finishedAt: status === "success" || status === "failed" ? Date.now() : s.finishedAt,
            }
          : s
      ),
    })),
  setConfig: (config) => set({ config }),
  setError: (error) => set({ error }),
  setRentalPlan: (rentalPlan) => set({ rentalPlan }),
  setRentalStatus: (rentalStatus) => set({ rentalStatus }),
  setRentalId: (rentalId) => set({ rentalId }),
  setRemainingMinutes: (remainingMinutes) => set({ remainingMinutes }),
  reset: () =>
    set({
      mode: null,
      step: 1,
      deployMethod: null,
      provider: null,
      region: "",
      plan: "",
      apiKey: "",
      serverIp: "",
      sshPort: 22,
      sshPassword: "",
      cleanupMode: "duration",
      cleanupHours: "24",
      cleanupAtInput: "",
      dnsToken: "",
      domain: "",
      protocol: null,
      deployId: null,
      status: "pending",
      steps: defaultSteps,
      config: null,
      error: null,
      rentalPlan: null,
      rentalStatus: null,
      rentalId: null,
      remainingMinutes: 0,
    }),
}));
