# Papyrus CLI

`@papyrus/cli` is the command-line layer for the current
[Papyrus Desktop](https://github.com/PapyrusOR/Papyrus_Desktop) TypeScript backend. It calls the
Desktop Fastify API and MCP bridge; it does not maintain a second database or start the legacy
Python/uvicorn server.

## Requirements

- Node.js 24 or newer
- Papyrus Desktop `BA13-release` or a compatible TypeScript backend
- The Desktop authentication token for write APIs

## Install and build

```powershell
npm.cmd ci
npm.cmd run build
node dist/cli.js --help
```

The published package provides both `papyrus` and `papyrus-cli` executables.

## Configuration

Runtime values use this priority order:

1. Command-line flags
2. Environment variables
3. `~/.papyrus/cli.json`
4. Built-in defaults

| Flag        | Environment variable | Default                     |
| ----------- | -------------------- | --------------------------- |
| `--api-url` | `PAPYRUS_API_URL`    | `http://127.0.0.1:8000/api` |
| `--mcp-url` | `PAPYRUS_MCP_URL`    | `http://127.0.0.1:9200`     |
| `--token`   | `PAPYRUS_AUTH_TOKEN` | unset                       |
| `--timeout` | `PAPYRUS_TIMEOUT_MS` | `30000`                     |

Authentication tokens are never persisted by `papyrus config`. Prefer the environment variable
when running under Desktop's CLI Manager.

```powershell
$env:PAPYRUS_AUTH_TOKEN = "<desktop-token>"
papyrus status --json
papyrus config show
papyrus config set apiUrl=http://127.0.0.1:8000/api
```

## Command surface

Every command accepts `--json`. Without it, output is still JSON but is pretty-printed for humans;
with it, output is one compact JSON object suitable for agents, scripts, and Desktop's CLI Manager.

### Cards and review

```powershell
papyrus cards list --json
papyrus cards show <card-id>
papyrus cards add "Question" "Answer" --tags learning,typescript
papyrus cards edit <card-id> --q "Updated question" --a "Updated answer"
papyrus cards delete <card-id>
papyrus cards batch-delete --ids id1,id2
papyrus cards import .\cards.txt
papyrus cards export --output .\cards.json
papyrus cards history <card-id>
papyrus cards version <card-id> <version-id>
papyrus cards rollback <card-id> <version-id>

papyrus review next
papyrus review rate <card-id> --grade 3
papyrus review stats
papyrus search "query" --limit 50 --offset 0
```

### Notes, files, and relations

```powershell
papyrus notes list
papyrus notes add "Title" --folder Inbox --content "Body" --tags tag1,tag2
papyrus notes edit <note-id> --content "Updated"
papyrus notes import-obsidian C:\Vault --exclude .git,node_modules
papyrus notes history <note-id>
papyrus notes rollback <note-id> <version-id>

papyrus files list
papyrus files mkdir "References" --parent-id <folder-id>
papyrus files upload .\paper.pdf --parent-id <folder-id> --mime-type application/pdf
papyrus files download <file-id> --output .\paper.pdf

papyrus relations list <note-id>
papyrus relations search "linked note" --exclude-note-id <note-id>
papyrus relations graph <note-id> --depth 2
papyrus relations add <source-note-id> <target-note-id> --type related
```

### Extensions, providers, sessions, and MCP

Structured resource payloads are supplied with `--body`; MCP parameters use `--params`.

```powershell
papyrus extensions list
papyrus extensions install-local .\extension.zip
papyrus extensions enable <extension-id>
papyrus extensions config <extension-id> --body '{"theme":"dark"}'

papyrus providers list
papyrus providers add --body '{"name":"Ollama","baseUrl":"http://127.0.0.1:11434"}'
papyrus providers enable <provider-id>

papyrus sessions list
papyrus sessions create "Research"
papyrus sessions switch <session-id>
papyrus sessions messages <session-id>

papyrus mcp health
papyrus mcp tools
papyrus mcp call get_review_stats --params '{}'
```

### Workspace automations

Workspace commands target the current Desktop workspace API:

```powershell
papyrus workspace projects list
papyrus workspace projects create --body '{"name":"Study","links":{"sessionIds":[]}}'
papyrus workspace projects reorder --ids project2,project1

papyrus workspace automations list
papyrus workspace automations create --body '{"name":"Daily review","target":"scroll","schedule":{"kind":"daily","localTime":"09:00"},"timezone":"Asia/Shanghai","enabled":true}'
papyrus workspace automations run <automation-id>
papyrus workspace runs pending
papyrus workspace runs acknowledge <run-id>
```

### Data and diagnostics

```powershell
papyrus progress streak
papyrus progress history --days 30
papyrus progress heatmap --days 365

papyrus data backup
papyrus data export --output .\papyrus-export.json
papyrus data import .\papyrus-export.json
papyrus data reset --force

papyrus manager status
papyrus manager install
papyrus manager update
```

`serve` now reports that Desktop owns the Fastify process. `stop` intentionally fails because a
separate CLI must not terminate the Desktop-managed backend.

For API additions that do not yet have a named command, use the authenticated escape hatch:

```powershell
papyrus request GET /future/route
papyrus request POST /future/route --body '{"enabled":true}'
```

## Development and verification

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:coverage
```

The tests cover configuration precedence and token handling, authenticated API requests, sanitized
errors, binary responses, command-to-route contracts, destructive-operation guards, and a real
HTTP round trip.

## License

MIT
