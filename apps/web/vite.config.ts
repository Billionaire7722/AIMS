import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const port = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    host: "0.0.0.0",
    port,
  },
});
