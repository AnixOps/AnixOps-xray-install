function normalizeWebhookUrl(value) {
  const raw = String(value || "").trim();
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function buildAlertMessage(input = {}) {
  const level = String(input.level || "warn").toUpperCase();
  const title = String(input.title || "AnixOps alert").trim();
  const detail = typeof input.detail === "string" && input.detail.trim() ? input.detail.trim() : "";
  const facts = Array.isArray(input.facts)
    ? input.facts.filter((item) => item && item.label && item.value !== undefined && item.value !== null)
    : [];

  return [
    `[${level}] ${title}`,
    detail || null,
    ...facts.map((item) => `${item.label}: ${item.value}`),
  ].filter(Boolean).join("\n");
}

async function sendAlertWebhook(webhookUrl, payload) {
  const url = normalizeWebhookUrl(webhookUrl);
  if (!url) {
    return false;
  }

  const message = buildAlertMessage(payload);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "anixops_alert",
      level: payload.level || "warn",
      title: payload.title || "AnixOps alert",
      detail: payload.detail || "",
      message,
      facts: Array.isArray(payload.facts) ? payload.facts : [],
      source: payload.source || "unknown",
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Alert webhook failed with HTTP ${response.status}`);
  }
  return true;
}

module.exports = {
  buildAlertMessage,
  normalizeWebhookUrl,
  sendAlertWebhook,
};
