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
  HOME: runtimeDir,
  USERPROFILE: runtimeDir,
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

function runCliFailure(args) {
  const result = spawnSync(node, [cli, ...args, "--json"], {
    cwd: cliRoot,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status === 0) {
    throw new Error(`CLI command unexpectedly succeeded (${args.join(" ")}): ${result.stdout}`);
  }
  return result.stderr;
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

  const fixtureDir = path.join(runtimeDir, "fixtures");
  const vaultDir = path.join(fixtureDir, "vault");
  fs.mkdirSync(vaultDir, { recursive: true });
  const cardImportPath = path.join(fixtureDir, "cards.txt");
  const cardExportPath = path.join(fixtureDir, "cards-export.json");
  const dataImportPath = path.join(fixtureDir, "data-import.json");
  const dataExportPath = path.join(fixtureDir, "data-export.json");
  const imagePath = path.join(fixtureDir, "pixel.png");
  const previewPath = path.join(fixtureDir, "pixel-preview.png");
  const downloadPath = path.join(fixtureDir, "pixel-download.png");
  const thumbnailPath = path.join(fixtureDir, "pixel-thumbnail.jpg");
  fs.writeFileSync(cardImportPath, "Imported question === Imported answer\n", "utf8");
  fs.writeFileSync(
    dataImportPath,
    JSON.stringify({
      cards: [
        { id: `imported-card-${runId}`, q: "Imported data question", a: "Imported data answer" },
      ],
      notes: [{ id: `imported-note-${runId}`, title: "Imported data note", content: "Imported" }],
    }),
    "utf8"
  );
  fs.writeFileSync(path.join(vaultDir, "runtime.md"), "# Runtime vault note\n\nImported by CLI.\n");
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
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
  const cardId = card.card?.id;
  assert(card.success && cardId, "Card creation contract failed");
  const cards = runCli(["cards", "list"]);
  const cardShow = runCli(["cards", "show", cardId]);
  const cardEdit = runCli(["cards", "edit", cardId, "--q", "Runtime question updated"]);
  const cardHistory = runCli(["cards", "history", cardId]);
  const cardVersionId = cardHistory.history?.[0]?.version_id;
  assert(cardVersionId, "Card edit did not create a version");
  const cardVersion = runCli(["cards", "version", cardId, cardVersionId]);
  const cardRollback = runCli(["cards", "rollback", cardId, cardVersionId]);
  const cardImport = runCli(["cards", "import", cardImportPath]);
  const cardExport = runCli(["cards", "export", "--output", cardExportPath]);
  const dueCards = runCli(["cards", "due"]);
  const reviewNext = runCli(["review", "next"]);
  const reviewRate = runCli(["review", "rate", cardId, "--grade", "3"]);
  const search = runCli(["search", "Runtime", "--limit", "50", "--offset", "0"]);
  const note = runCli(["notes", "add", "Runtime note", "--content", "CLI runtime verification"]);
  const noteId = note.note?.id;
  assert(note.success && noteId, "Note creation contract failed");
  const relatedNote = runCli([
    "notes",
    "add",
    "Related runtime note",
    "--content",
    "Relation target",
  ]);
  const relatedNoteId = relatedNote.note?.id;
  assert(relatedNote.success && relatedNoteId, "Related note creation contract failed");
  const noteShow = runCli(["notes", "show", noteId]);
  const noteEdit = runCli([
    "notes",
    "edit",
    noteId,
    "--content",
    "CLI runtime verification updated",
  ]);
  const noteHistory = runCli(["notes", "history", noteId]);
  const noteVersionId = noteHistory.history?.[0]?.version_id;
  assert(noteVersionId, "Note edit did not create a version");
  const noteVersion = runCli(["notes", "version", noteId, noteVersionId]);
  const noteRollback = runCli(["notes", "rollback", noteId, noteVersionId]);
  const obsidianImport = runCli(["notes", "import-obsidian", vaultDir, "--exclude", ".git"]);
  const notes = runCli(["notes", "list"]);

  const relation = runCli([
    "relations",
    "add",
    noteId,
    relatedNoteId,
    "--type",
    "related",
    "--description",
    "runtime relation",
  ]);
  const relationId = relation.relation_id;
  assert(relation.success && relationId, "Relation creation contract failed");
  const relationList = runCli(["relations", "list", noteId]);
  const relationSearch = runCli([
    "relations",
    "search",
    "Related",
    "--exclude-note-id",
    noteId,
    "--limit",
    "10",
  ]);
  const relationGraph = runCli(["relations", "graph", noteId, "--depth", "2"]);
  const relationEdit = runCli([
    "relations",
    "edit",
    relationId,
    "--description",
    "runtime relation updated",
  ]);

  const folder = runCli(["files", "mkdir", "Runtime files"]);
  const folderId = folder.file?.id;
  assert(folder.success && folderId, "File folder creation contract failed");
  const upload = runCli([
    "files",
    "upload",
    imagePath,
    "--parent-id",
    folderId,
    "--mime-type",
    "image/png",
  ]);
  const fileId = upload.files?.[0]?.id;
  assert(upload.success && fileId, "File upload contract failed");
  const files = runCli(["files", "list"]);
  const fileShow = runCli(["files", "show", fileId]);
  const filePreview = runCli(["files", "preview", fileId, "--output", previewPath]);
  const fileDownload = runCli(["files", "download", fileId, "--output", downloadPath]);
  const fileThumbnail = runCli(["files", "thumbnail", fileId, "--output", thumbnailPath]);
  const directDownloadResponse = await fetch(
    `http://127.0.0.1:${apiPort}/api/files/${fileId}/download`,
    { headers: { "X-Papyrus-Token": env.PAPYRUS_AUTH_TOKEN } }
  );
  const directDownload = Buffer.from(await directDownloadResponse.arrayBuffer());

  const extensionId = `runtime-extension-${runId}`;
  const extension = runCli(["extensions", "install", extensionId, "--name", "Runtime extension"]);
  const extensionShow = runCli(["extensions", "show", extensionId]);
  const extensionEnable = runCli(["extensions", "enable", extensionId]);
  const extensionConfig = runCli([
    "extensions",
    "config",
    extensionId,
    "--body",
    '{"mode":"runtime"}',
  ]);
  const extensionUpdates = runCli(["extensions", "check-updates"]);
  const extensionDisable = runCli(["extensions", "disable", extensionId]);
  const extensions = runCli(["extensions", "list"]);

  const provider = runCli([
    "providers",
    "add",
    "--body",
    JSON.stringify({
      type: "ollama",
      name: "Runtime provider",
      baseUrl: "http://127.0.0.1:11434",
      enabled: true,
    }),
  ]);
  const providerId = provider.provider?.id;
  assert(provider.success && providerId, "Provider creation contract failed");
  const providerUpdate = runCli([
    "providers",
    "update",
    providerId,
    "--body",
    '{"name":"Runtime provider updated"}',
  ]);
  const providerDefault = runCli(["providers", "default", providerId]);
  const providerDisable = runCli(["providers", "disable", providerId]);
  const providerEnable = runCli(["providers", "enable", providerId]);
  const providerModel = runCli([
    "providers",
    "model-add",
    providerId,
    "--body",
    '{"name":"Runtime model","modelId":"runtime-model"}',
  ]);
  const modelId = providerModel.modelId;
  assert(providerModel.success && modelId, "Provider model creation contract failed");
  const providerModelUpdate = runCli([
    "providers",
    "model-update",
    providerId,
    modelId,
    "--body",
    '{"name":"Runtime model updated","modelId":"runtime-model-updated"}',
  ]);
  const providerKey = runCli([
    "providers",
    "key-add",
    providerId,
    "--body",
    '{"name":"runtime-key","key":"runtime-secret"}',
  ]);
  const keyId = providerKey.keyId;
  assert(providerKey.success && keyId, "Provider key creation contract failed");
  const providers = runCli(["providers", "list"]);

  const session = runCli(["sessions", "create", "Runtime session"]);
  const sessionId = session.session?.id;
  assert(session.success && sessionId, "Session creation contract failed");
  const sessionSwitch = runCli(["sessions", "switch", sessionId]);
  const sessionRename = runCli(["sessions", "rename", sessionId, "Runtime session updated"]);
  const sessionMessages = runCli(["sessions", "messages", sessionId]);
  const sessions = runCli(["sessions", "list"]);

  const project = runCli([
    "workspace",
    "projects",
    "create",
    "--body",
    '{"name":"Runtime project","links":{"sessionIds":[]}}',
  ]);
  const projectId = project.project?.id;
  assert(project.success && projectId, "Workspace project creation contract failed");
  const projectShow = runCli(["workspace", "projects", "show", projectId]);
  const projectUpdate = runCli([
    "workspace",
    "projects",
    "update",
    projectId,
    "--body",
    JSON.stringify({ name: "Runtime project updated", links: { sessionIds: [sessionId] } }),
  ]);
  const projectReorder = runCli(["workspace", "projects", "reorder", "--ids", projectId]);
  const projects = runCli(["workspace", "projects", "list"]);

  const automationBody = JSON.stringify({
    name: "Runtime automation",
    target: "scroll",
    schedule: { kind: "daily", localTime: "09:00" },
    timezone: "Asia/Shanghai",
    enabled: true,
  });
  const automation = runCli(["workspace", "automations", "create", "--body", automationBody]);
  const automationId = automation.automation?.id;
  assert(automation.success && automationId, "Workspace automation creation contract failed");
  const automationShow = runCli(["workspace", "automations", "show", automationId]);
  const automationUpdate = runCli([
    "workspace",
    "automations",
    "update",
    automationId,
    "--body",
    JSON.stringify({ ...JSON.parse(automationBody), name: "Runtime automation updated" }),
  ]);
  const automationRun = runCli(["workspace", "automations", "run", automationId]);
  const automationRuns = runCli(["workspace", "runs", "pending"]);
  const run = automationRuns.runs?.find((item) => item.automationId === automationId);
  assert(run?.id, "Manual automation run did not produce a pending run");
  const automationAcknowledge = runCli(["workspace", "runs", "acknowledge", run.id]);
  const automations = runCli(["workspace", "automations", "list"]);

  const mcpHealth = runCli(["mcp", "health"]);
  const mcp = runCli(["mcp", "tools"]);
  const mcpCall = runCli(["mcp", "call", "get_review_stats", "--params", "{}"]);
  const stats = runCli(["review", "stats"]);
  const progressStreak = runCli(["progress", "streak"]);
  const progressHistory = runCli(["progress", "history", "--days", "30"]);
  const progressHeatmap = runCli(["progress", "heatmap", "--days", "365"]);
  const backup = runCli(["data", "backup"]);
  const dataExport = runCli(["data", "export", "--output", dataExportPath]);
  const dataImport = runCli(["data", "import", dataImportPath]);
  const managerStatus = runCli(["manager", "status"]);
  const genericRequest = runCli(["request", "GET", "/health"]);
  const configShow = runCli(["config", "show"]);
  const configSet = runCli(["config", "set", "timeoutMs=45000"]);
  const configUpdated = runCli(["config", "show"]);
  const serve = runCli(["serve"]);
  const docs = runCli(["docs"]);
  const stopError = runCliFailure(["stop"]);
  const dataResetGuard = runCliFailure(["data", "reset"]);
  const sessionClearGuard = runCliFailure(["sessions", "clear"]);

  assert(status.success && status.health?.status === "ok", "Status contract failed");
  assert(cards.success && cards.count >= 1, "Card list contract failed");
  for (const [name, result] of Object.entries({
    cardShow,
    cardEdit,
    cardVersion,
    cardRollback,
    cardImport,
    cardExport,
    dueCards,
    reviewNext,
    reviewRate,
    search,
    noteShow,
    noteEdit,
    noteVersion,
    noteRollback,
    obsidianImport,
    notes,
    relationList,
    relationSearch,
    relationGraph,
    relationEdit,
    folder,
    files,
    fileShow,
    filePreview,
    fileDownload,
    fileThumbnail,
    extension,
    extensionShow,
    extensionEnable,
    extensionConfig,
    extensionUpdates,
    extensionDisable,
    extensions,
    providerUpdate,
    providerDefault,
    providerDisable,
    providerEnable,
    providerModelUpdate,
    providers,
    sessionSwitch,
    sessionRename,
    sessionMessages,
    sessions,
    projectShow,
    projectUpdate,
    projectReorder,
    projects,
    automationShow,
    automationUpdate,
    automationRun,
    automationAcknowledge,
    automations,
    mcpHealth,
    mcpCall,
    stats,
    progressStreak,
    progressHistory,
    progressHeatmap,
    backup,
    dataExport,
    dataImport,
    genericRequest,
    configShow,
    configSet,
    configUpdated,
    serve,
    docs,
  })) {
    assert(result?.success !== false, `${name} reported failure`);
  }
  assert(fs.existsSync(cardExportPath), "Card export did not write its output file");
  assert(fs.existsSync(dataExportPath), "Data export did not write its output file");
  assert(
    fs.readFileSync(downloadPath).equals(fs.readFileSync(imagePath)),
    `File download changed bytes (CLI=${fileDownload.bytes}, direct=${directDownload.length})`
  );
  assert(
    fs.readFileSync(previewPath).equals(fs.readFileSync(imagePath)),
    "File preview changed bytes"
  );
  assert(fs.statSync(thumbnailPath).size > 0, "File thumbnail is empty");
  assert(configUpdated.config?.timeoutMs === 45000, "Config set/show persistence failed");
  assert(managerStatus && typeof managerStatus === "object", "Manager status contract failed");
  assert(stopError.trim(), "Managed stop failure did not report an error");
  assert(dataResetGuard.trim(), "Data reset guard did not report an error");
  assert(sessionClearGuard.trim(), "Session clear guard did not report an error");
  assert(
    Array.isArray(mcp.tools) && mcp.tools.includes("get_review_stats"),
    "MCP catalog contract failed"
  );
  assert(stats.success, "MCP review stats contract failed");

  process.stdout.write(
    `${JSON.stringify({ success: true, apiPort, mcpPort, cardId, noteId, projectId, sessionId, automationId, fileId, providerId, extensionId, cardCount: cards.count, noteCount: notes.count, commandGroups: 18, runtimeDir })}\n`
  );
} finally {
  backend.kill();
  await Promise.race([new Promise((resolve) => backend.once("exit", resolve)), delay(5000)]);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
}
