import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");
const desktopRoot = path.resolve(
  process.env.PAPYRUS_DESKTOP_ROOT ?? path.join(cliRoot, "..", "Papyrus_Desktop")
);
async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to allocate a smoke-test port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return String(address.port);
}

const apiPort = process.env.PAPYRUS_SMOKE_API_PORT ?? (await findFreePort());
const mcpPort = process.env.PAPYRUS_SMOKE_MCP_PORT ?? (await findFreePort());
const node = path.join(desktopRoot, ".tools", "node-v24.18.0-win-x64", "node.exe");
const tsx = path.join(desktopRoot, "backend", "node_modules", "tsx", "dist", "cli.mjs");
const server = path.join(desktopRoot, "backend", "src", "api", "server.ts");
const cli = path.join(cliRoot, "dist", "cli.js");

for (const requiredPath of [node, tsx, server, cli]) {
  if (!fs.existsSync(requiredPath))
    throw new Error(`Required runtime path is missing: ${requiredPath}`);
}

const runId = randomUUID().replaceAll("-", "");
const runtimeDir = path.join(cliRoot, ".runtime-smoke", runId);
fs.mkdirSync(runtimeDir, { recursive: true });
const env = {
  ...process.env,
  PAPYRUS_DATA_DIR: runtimeDir,
  PAPYRUS_PORT: apiPort,
  PAPYRUS_MCP_PORT: mcpPort,
  PAPYRUS_AUTH_TOKEN: `papyrus-cli-runtime-smoke-token-${runId}`,
  PAPYRUS_API_URL: `http://127.0.0.1:${apiPort}/api`,
  PAPYRUS_MCP_URL: `http://127.0.0.1:${mcpPort}`,
  NODE_ENV: "development",
};

const stdout = fs.openSync(path.join(runtimeDir, "backend.stdout.log"), "a");
const stderr = fs.openSync(path.join(runtimeDir, "backend.stderr.log"), "a");
const backend = spawn(node, [tsx, server], {
  cwd: path.join(desktopRoot, "backend"),
  env,
  windowsHide: true,
  stdio: ["ignore", stdout, stderr],
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (backend.exitCode !== null) throw new Error("Desktop backend exited before becoming ready");
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      const health = await response.json();
      if (response.ok && health.status === "ok") return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error("Desktop backend did not become ready");
}

function runCli(args) {
  const result = spawnSync(node, [cli, ...args, "--json"], {
    cwd: cliRoot,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`CLI command failed (${args.join(" ")}): ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForHealth();
  const authenticatedProbe = await fetch(`http://127.0.0.1:${apiPort}/api/cards`, {
    headers: { "X-Papyrus-Token": env.PAPYRUS_AUTH_TOKEN },
  });
  assert(
    authenticatedProbe.ok,
    `Direct Desktop authentication failed: HTTP ${authenticatedProbe.status}`
  );
  const status = runCli(["status"]);
  const card = runCli([
    "cards",
    "add",
    "Runtime question",
    "Runtime answer",
    "--tags",
    "runtime,cli",
  ]);
  const cards = runCli(["cards", "list"]);
  const note = runCli(["notes", "add", "Runtime note", "--content", "CLI runtime verification"]);
  const project = runCli([
    "workspace",
    "projects",
    "create",
    "--body",
    '{"name":"Runtime project","links":{"sessionIds":[]}}',
  ]);
  const mcp = runCli(["mcp", "tools"]);
  const stats = runCli(["review", "stats"]);

  assert(status.success && status.health?.status === "ok", "Status contract failed");
  assert(card.success && card.card?.id, "Card creation contract failed");
  assert(cards.success && cards.count >= 1, "Card list contract failed");
  assert(note.success && note.note?.id, "Note creation contract failed");
  assert(project.success && project.project?.id, "Workspace contract failed");
  assert(
    Array.isArray(mcp.tools) && mcp.tools.includes("get_review_stats"),
    "MCP catalog contract failed"
  );
  assert(stats.success, "MCP review stats contract failed");

  process.stdout.write(
    `${JSON.stringify({ success: true, apiPort, mcpPort, cardId: card.card.id, noteId: note.note.id, projectId: project.project.id, cardCount: cards.count, runtimeDir })}\n`
  );
} finally {
  backend.kill();
  await Promise.race([new Promise((resolve) => backend.once("exit", resolve)), delay(5000)]);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
}
