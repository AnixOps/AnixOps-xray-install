export interface VPSInfo {
  id: string;
  ip: string;
  status: string;
}

export interface CloudProvider {
  createServer(params: { region: string; plan: string; sshKey?: string; tag?: string }): Promise<VPSInfo>;
  getServer(id: string): Promise<VPSInfo>;
  deleteServer(id: string): Promise<void>;
  listServersByTag(tag: string): Promise<VPSInfo[]>;
}
