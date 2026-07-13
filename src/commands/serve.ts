import { createPapyrusClient } from "../api.js";

export async function serveCommand(options: {
  port?: number;
  host?: string;
  detach?: boolean;
}): Promise<void> {
  const requested =
    options.port !== undefined || options.host !== undefined || options.detach === true;
  console.log(
    JSON.stringify({
      success: true,
      managedBy: "Papyrus Desktop",
      message: "TypeScript/Fastify 后端由 Desktop 主进程托管，无需 CLI 启动。",
      ...(requested ? { ignoredLegacyOptions: options } : {}),
    })
  );
}

export async function statusCommand(): Promise<void> {
  const client = createPapyrusClient();
  const health = await client.request("/health");
  console.log(
    JSON.stringify({
      success: true,
      apiBase: client.apiBase,
      mcpBase: client.mcpBase,
      health,
    })
  );
}

export async function stopCommand(): Promise<void> {
  throw new Error("Desktop 托管模式不允许 CLI 停止后端");
}

export async function docsCommand(): Promise<void> {
  const client = createPapyrusClient();
  console.log(
    JSON.stringify({
      success: true,
      health: `${client.apiBase}/health`,
      note: "API 契约位于 Papyrus_Desktop/docs/API.md",
    })
  );
}
