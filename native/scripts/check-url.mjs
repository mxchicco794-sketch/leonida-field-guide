import { parseLeonidaWebUrl } from "./url-config.mjs";

const value = process.env.LEONIDA_WEB_URL;
if (!value) {
  console.log("Using the bundled local web app (native/www).");
} else {
  const url = parseLeonidaWebUrl(value);
  console.log(`Using configured remote web app: ${url.origin}`);
}
