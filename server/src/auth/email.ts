import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { ServerEnv } from "../config/env.js";

const REQUIRED_SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"] as const;

type SmtpKey = (typeof REQUIRED_SMTP_KEYS)[number];

export function getMissingSmtpKeys(config: Pick<ServerEnv, SmtpKey>): SmtpKey[] {
  return REQUIRED_SMTP_KEYS.filter((key) => !String(config[key] || "").trim());
}

export function isSmtpConfigured(config: Pick<ServerEnv, SmtpKey>): boolean {
  const port = Number.parseInt(config.SMTP_PORT || "", 10);
  return getMissingSmtpKeys(config).length === 0 && Number.isInteger(port) && port > 0 && port <= 65535;
}

export function createMagicLinkMailer(config: ServerEnv): Transporter | null {
  if (!isSmtpConfigured(config)) {
    return null;
  }

  const host = String(config.SMTP_HOST);
  const port = Number.parseInt(config.SMTP_PORT || "", 10);
  const user = String(config.SMTP_USER);
  const pass = String(config.SMTP_PASS);

  return nodemailer.createTransport({
    host,
    port,
    secure: config.SMTP_SECURE === "true",
    auth: {
      user,
      pass,
    },
  });
}

function normalizeReturnToPath(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("://")) {
    return "";
  }
  return normalized;
}

export function buildMagicLink(frontendUrl: string, token: string, returnTo = ""): string {
  const callbackUrl = `${frontendUrl.replace(/\/+$/, "")}/auth/callback?token=${encodeURIComponent(token)}`;
  const normalizedReturnTo = normalizeReturnToPath(returnTo);
  if (!normalizedReturnTo) {
    return callbackUrl;
  }
  return `${callbackUrl}&returnTo=${encodeURIComponent(normalizedReturnTo)}`;
}

export async function sendMagicLinkEmail({
  mailer,
  env,
  email,
  token,
  returnTo = "",
}: {
  mailer: Transporter | null;
  env: ServerEnv;
  email: string;
  token: string;
  returnTo?: string;
}): Promise<void> {
  if (!mailer) {
    throw new Error("SMTP is not configured");
  }

  const link = buildMagicLink(env.FRONTEND_URL, token, returnTo);
  await mailer.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: email,
    subject: "Your AnixOps sign-in link",
    text: `Sign in to AnixOps: ${link}`,
    html: `<p>Sign in to AnixOps:</p><p><a href="${link}">${link}</a></p>`,
  });
}
