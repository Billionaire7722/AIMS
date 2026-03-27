import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serviceRoot = resolve(scriptDir, "..");
const args = process.argv.slice(2);

const candidates = process.platform === "win32"
  ? [resolve(serviceRoot, ".venv", "Scripts", "python.exe"), "python"]
  : [resolve(serviceRoot, ".venv", "bin", "python"), "python3", "python"];

const python = await pickPython(candidates);
const child = spawn(python, args, {
  cwd: serviceRoot,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

async function pickPython(candidates) {
  for (const candidate of candidates) {
    if (!candidate.includes("python")) {
      continue;
    }
    if (candidate === "python" || candidate === "python3") {
      return candidate;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
