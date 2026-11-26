const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseLeonidaWebUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("LEONIDA_WEB_URL must be a non-empty HTTPS URL.");
  }
  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error("LEONIDA_WEB_URL must be a valid absolute URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error("LEONIDA_WEB_URL must use HTTPS (HTTP is allowed only for localhost).");
  }
  if (url.username || url.password) throw new Error("LEONIDA_WEB_URL must not contain credentials.");
  if (url.hash) throw new Error("LEONIDA_WEB_URL must not contain a fragment.");
  return url;
}
