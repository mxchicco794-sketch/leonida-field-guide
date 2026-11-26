import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Experimental static client shell for Capacitor. The default web build is untouched.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      spa: {
        enabled: true,
        prerender: { outputPath: "/index.html", crawlLinks: false, retryCount: 0 },
      },
    }),
    nitro(),
    viteReact(),
    tailwindcss(),
  ],
});
