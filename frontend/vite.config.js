import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CSP for production build (removes Electron security warning in packaged app).
// script-src includes 'unsafe-inline' because the legacy UI uses inline event handlers (onclick, onchange, etc.).
// Not applied in dev so Vite HMR can run.
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: https: http:; connect-src \'self\' http://localhost:* http://127.0.0.1:* https:; font-src \'self\'; base-uri \'self\'">';

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
