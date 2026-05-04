// Simple structured logger for provision server

type LogLevel = "info" | "warn" | "error";

function format(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const base = { ts, level, msg: message };
  if (meta) Object.assign(base, meta);
  return JSON.stringify(base);
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    process.stdout.write(format("info", message, meta) + "\n");
  },
  warn(message: string, meta?: Record<string, unknown>) {
    process.stdout.write(format("warn", message, meta) + "\n");
  },
  error(message: string, meta?: Record<string, unknown>) {
    process.stderr.write(format("error", message, meta) + "\n");
  },
};
