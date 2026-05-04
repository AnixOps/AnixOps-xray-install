export type DeployMethod = "api" | "ssh";
export type CloudProvider = "vultr" | "digitalocean" | "aws";
export type Protocol = "vless-reality" | "hysteria2";
export type DeployStatus = "pending" | "running" | "success" | "failed";
export type AppMode = "self-hosted" | "rental";
export type RentalStatus = "provisioning" | "active" | "paused" | "expired" | "destroyed";

import { PRICING } from "@/lib/rental/rules";

export interface DeployStep {
  id: string;
  label: string;
  status: "pending" | "running" | "success" | "failed";
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface SelfHostedConfig {
  deployMethod: DeployMethod;
  provider: CloudProvider | null;
  apiKey: string;
  region: string;
  plan: string;
  // SSH direct connect
  serverIp: string;
  sshPort: number;
  sshPassword: string;
  // Shared
  dnsToken: string;
  domain: string;
  protocol: Protocol;
}

export interface SelfHostedResult {
  deployId: string;
  status: DeployStatus;
  ip: string;
  protocol: Protocol;
  config: Record<string, string>;
  createdAt: string;
}

export interface RentalPlan {
  id: string;
  durationHours: number;
  pricePerHour: number;
  totalPrice: number;
}

export interface RentalOrder {
  rentalId: string;
  protocol: Protocol;
  status: RentalStatus;
  ip: string;
  config: Record<string, string>;
  startedAt: string;
  expiresAt: string;
  pausedAt?: string;
  remainingMinutes: number;
}

export interface ProgressEvent {
  stepId: string;
  status: "running" | "success" | "failed";
  message?: string;
  data?: Record<string, unknown>;
}

export const PROTOCOL_INFO: Record<Protocol, { nameKey: string; descKey: string; icon: string; priceKey: string }> = {
  "vless-reality": {
    nameKey: "protocol.vless",
    descKey: "protocol.vless.desc",
    icon: "🛡️",
    priceKey: "protocol.rentalPrice",
  },
  hysteria2: {
    nameKey: "protocol.hysteria2",
    descKey: "protocol.hysteria2.desc",
    icon: "⚡",
    priceKey: "protocol.rentalPrice",
  },
};

export const RENTAL_PLANS: RentalPlan[] = [
  { id: "1h", durationHours: 1, ...PRICING[1] },
  { id: "6h", durationHours: 6, ...PRICING[6] },
  { id: "12h", durationHours: 12, ...PRICING[12] },
  { id: "24h", durationHours: 24, ...PRICING[24] },
];

export const PROVIDER_INFO: Record<CloudProvider, { name: string; regions: { id: string; nameKey: string }[]; plans: { id: string; name: string; priceKey: string }[] }> = {
  vultr: {
    name: "Vultr",
    regions: [
      { id: "nrt", nameKey: "provider.region.tokyo" },
      { id: "sin", nameKey: "provider.region.singapore" },
      { id: "lax", nameKey: "provider.region.la" },
      { id: "sea", nameKey: "provider.region.seattle" },
      { id: "fra", nameKey: "provider.region.frankfurt" },
    ],
    plans: [
      { id: "vhf-1c-1gb", name: "1C 1GB 25GB", priceKey: "provider.price.monthly5" },
      { id: "vhf-2c-2gb", name: "2C 2GB 50GB", priceKey: "provider.price.monthly10" },
    ],
  },
  digitalocean: {
    name: "DigitalOcean",
    regions: [
      { id: "nyc3", nameKey: "provider.region.ny" },
      { id: "sfo3", nameKey: "provider.region.sf" },
      { id: "sgp1", nameKey: "provider.region.singapore" },
      { id: "fra1", nameKey: "provider.region.frankfurt" },
    ],
    plans: [
      { id: "s-1vcpu-1gb", name: "1C 1GB 25GB", priceKey: "provider.price.monthly6" },
      { id: "s-2vcpu-2gb", name: "2C 2GB 50GB", priceKey: "provider.price.monthly12" },
    ],
  },
  aws: {
    name: "AWS EC2",
    regions: [
      { id: "ap-northeast-1", nameKey: "provider.region.tokyo" },
      { id: "ap-southeast-1", nameKey: "provider.region.singapore" },
      { id: "us-west-2", nameKey: "provider.region.oregon" },
      { id: "eu-central-1", nameKey: "provider.region.frankfurt" },
    ],
    plans: [
      { id: "t3.micro", name: "2C 1GB", priceKey: "provider.price.awsFreeTier" },
      { id: "t3.small", name: "2C 2GB", priceKey: "provider.price.monthly15" },
    ],
  },
};
