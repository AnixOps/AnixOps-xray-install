import { EC2, type RunInstancesCommandInput, type DescribeInstancesCommandInput, type _InstanceType } from "@aws-sdk/client-ec2";
import type { CloudProvider, VPSInfo } from "../provider.js";

// Ubuntu 22.04 LTS AMIs per region (official, HVM, SSD)
const UBUNTU_AMI: Record<string, string> = {
  "us-east-1": "ami-0c55b159cbfafe1f0",
  "us-west-1": "ami-0d593311dbbfabb4e",
  "us-west-2": "ami-074b57563995d43e3",
  "eu-west-1": "ami-0a8dc5268061354a9",
  "ap-northeast-1": "ami-0e3b4a4e0e3b4a4e0",
  "ap-southeast-1": "ami-0a3b4a4e0e3b4a4e0",
};

export function createAWSProvider(region: string, accessKeyId: string, secretAccessKey: string): CloudProvider {
  const ec2 = new EC2({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async createServer({ region: _region, plan, sshKey, tag, userData }): Promise<VPSInfo> {
      const amiId = UBUNTU_AMI[region] || UBUNTU_AMI["us-east-1"];

      const params: RunInstancesCommandInput = {
        ImageId: amiId,
        InstanceType: plan as _InstanceType,
        MinCount: 1,
        MaxCount: 1,
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: [
              { Key: "Name", Value: tag ? `anixops-${tag}` : `anixops-rental-${Date.now()}` },
              { Key: "ManagedBy", Value: "AnixOps" },
              { Key: "RentalId", Value: tag || "" },
            ],
          },
        ],
        KeyName: sshKey,
        SecurityGroupIds: [process.env.AWS_SECURITY_GROUP_ID || ""],
      };

      if (userData) {
        params.UserData = Buffer.from(userData).toString("base64");
      }

      if (!params.SecurityGroupIds?.[0]) {
        throw new Error("AWS_SECURITY_GROUP_ID is required (security group must allow inbound 22/TCP, 443/TCP, 443/UDP)");
      }

      const result = await ec2.runInstances(params);
      const instance = result.Instances?.[0];

      if (!instance?.InstanceId) {
        throw new Error("Failed to create EC2 instance");
      }

      // EC2 instances don't get public IPs immediately — return ID, caller must poll
      return {
        id: instance.InstanceId,
        ip: "", // Will be filled by waitForSSH via polling
        status: instance.State?.Name || "pending",
      };
    },

    async getServer(id: string): Promise<VPSInfo> {
      const params: DescribeInstancesCommandInput = { InstanceIds: [id] };
      const result = await ec2.describeInstances(params);
      const instance = result.Reservations?.[0]?.Instances?.[0];

      if (!instance) {
        throw new Error(`EC2 instance ${id} not found`);
      }

      return {
        id,
        ip: instance.PublicIpAddress || "",
        status: instance.State?.Name || "unknown",
      };
    },

    async deleteServer(id: string): Promise<void> {
      await ec2.terminateInstances({ InstanceIds: [id] });
    },

    async listServersByTag(tag: string): Promise<VPSInfo[]> {
      const result = await ec2.describeInstances({
        Filters: [
          { Name: "tag:RentalId", Values: [tag] },
          { Name: "instance-state-name", Values: ["pending", "running", "stopping", "stopped"] },
        ],
      });
      const instances = result.Reservations?.flatMap((r) => r.Instances ?? []) ?? [];
      return instances.map((i) => ({
        id: i.InstanceId!,
        ip: i.PublicIpAddress || "",
        status: i.State?.Name || "unknown",
      }));
    },
  };
}
