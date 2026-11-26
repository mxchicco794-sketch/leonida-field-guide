import type { CapacitorConfig } from "@capacitor/cli";
import { parseLeonidaWebUrl } from "./scripts/url-config.mjs";

const configuredUrl = process.env.LEONIDA_WEB_URL?.trim();
const server = configuredUrl
  ? (() => {
      const url = parseLeonidaWebUrl(configuredUrl);
      return {
        url: url.toString(),
        cleartext: false,
        allowNavigation: [url.hostname],
      };
    })()
  : undefined;

const config: CapacitorConfig = {
  appId: "com.leonida.companion",
  appName: "Leonida Companion",
  webDir: "www",
  ...(server ? { server } : {}),
  android: { allowMixedContent: false },
};

export default config;
