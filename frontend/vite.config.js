import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Strict CSP for production build only (removes Electron security warning in packaged app).
// Not applied in dev so Vite HMR can run.
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\' http://localhost:* http://127.0.0.1:*; font-src \'self\'; base-uri \'self\'">';

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "csp-production",
      transformIndexHtml(html, ctx) {
        if (ctx.server) return html;
        return html.replace("</head>", `${CSP_META}\n  </head>`);
      }
    }
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000"
    }
  }
});
