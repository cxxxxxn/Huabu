# Agent Reachback

## Overview

Agent Reachback lets an external agent attached through Agentlet access the active Huabu Space outside the normal chat prompt. Huabu exposes a canvas-scoped Remote File System (RFS) HTTP base in `HUABU_RFS_URL` and a bearer credential in `AGENTLET_TOKEN`.

The surface separates byte transfer from semantic canvas work:

```text
External agent
  ├─ skill ──────────────> bundled/override root guide + live Space Skill Frames + advanced guides
  ├─ download / upload ──> canvas file projection
  ├─ query ──────────────> canonical SpaceQuery dispatcher
  ├─ query SNAPSHOT_NODES ──> shared snapshot renderer ──> PNG artifact
  ├─ execute ────────────> agent command preparation ──> CanvasCommand engine
  └─ agent ──────────────> internal Huabu agent ──> CanvasCommand engine
```

The shipped design record is [`agent-reachback-rfs.md`](../proposals/agent-reachback-rfs.md). The planned deterministic query and mutation extension is [`direct-space-operations.md`](../proposals/direct-space-operations.md).

## Canvas-scoped HTTP surface

All endpoints are mounted under `/api/rfs/:canvasId`; `HUABU_RFS_URL` already contains that canvas-scoped base.

| Endpoint                           | Responsibility                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /skill`                       | Return the public bundled root guide; authenticated requests resolve the current root guide and append live Skill Frames.           |
| `GET /skill/:skillId`              | Return an authenticated advanced guide: `layout`, `tasks`, `agents`, `interactive-views`, or `service-config`.                      |
| `GET /download/<path>`             | Stream a known node, artifact, or staged-upload file.                                                                               |
| `POST /upload/<name>`              | Stage bytes in the canvas `.upload/` directory without creating a node.                                                             |
| `DELETE /upload/<name>`            | Remove one exact staged upload.                                                                                                     |
| `POST /agent`                      | Create a visible Agent Node and optionally start its first turn.                                                                    |
| `POST /agent/:threadId/prompt`     | Submit a turn to an existing Agent conversation over SSE.                                                                           |
| `POST /agent/:threadId/ink-intent` | Submit a validated report for the matching active external Ink turn.                                                                |
| `GET /agent/profiles`              | Return available Agent Profile IDs and aliases, marking the first selectable external fallback with `default: true` when available. |
| `POST /task/create`                | Create a durable Task and its static Task Note.                                                                                     |
| `POST /task/:taskId/run/create`    | Create a Run, its visible root Agent Node, and start the first turn.                                                                |
| `GET /capabilities`                | Report the direct-operation protocol, limits, semantics, and supported operation types.                                             |
| `GET /capabilities/queries/:type`  | Return one query's generated JSON Schema, constraints, result description, and examples.                                            |
| `GET /capabilities/commands/:type` | Return one command's generated JSON Schema, constraints, result description, and examples.                                          |
| `GET /services`                    | List configured third-party Services and masked availability.                                                                       |
| `GET /services/:id/manifest`       | Return one Service Package's validated Manifest without credentials.                                                                |
| `GET /services/:id/skill`          | Return an Agent-facing Service Package's root `SKILL.md`.                                                                           |
| `POST /services/:id/lease`         | Return the declared effective configuration for one configured Agent-facing Service with `Cache-Control: no-store`.                 |
| `GET /download/services/:id.zip`   | Stream one Agent-facing Package as `<serviceId>/service.yaml` plus its exact Manifest-declared files.                               |
| `POST /query`                      | Validate and execute one bounded `SpaceQuery`, returning a query-discriminated JSON result.                                         |
| `POST /execute`                    | Validate and execute an ordered batch of agent-allowed `CanvasCommand` variants.                                                    |

There is no directory-listing endpoint. External agents receive exact node paths in selected-node context or ask the internal agent to discover relevant files.

## Direct query plane

`POST /query` accepts the canonical discriminated union from `packages/shared/src/types/api/space-operations.ts`: `GET_SPACE_OUTLINE`, `INSPECT_NODES`, `INSPECT_EDGES`, `SEARCH`, or `SNAPSHOT_NODES`. The RFS route validates JSON and delegates to `executeSpaceQuery()`; spatial queries reuse the existing canvas spatial services, search collects the existing cancellable event stream into a bounded JSON result, and snapshot delegates to the shared renderer. The route does not duplicate query semantics.

Capability detail schemas are generated from the same Zod registry used for request validation and built-in agent tools. Query responses remain bounded and carry metadata rather than large bodies; node content and snapshot artifact bytes are still read through `download`. `INSPECT_NODES` includes a non-empty `threadId` only for Question Nodes that currently have a thread association. This read-only mapping lets an authenticated RFS caller discover an Agent Node and continue its existing conversation through `POST /agent/:threadId/prompt`; it does not create or realize any Agent state.

## Direct execution plane

`POST /execute` accepts `{ runId?, commands }`, rejects caller-supplied originator context and UI-only command variants, stamps server-owned agent authorship metadata, and invokes `executeOnServer()` with `{ source: 'agent' }`. The same preparation helper is used by the built-in `space_commands` tool; RFS does not call the Canvas HTTP route or duplicate executor behavior.

Node command `content` fields contain only the authored Markdown body, while downloads expose the complete sidecar with server-owned YAML frontmatter. Agent command preparation defensively unwraps a submitted leading frontmatter block only when its `id` exactly matches the `MERGE_NODE_DATA` target, preventing a downloaded sidecar from being nested into its own body without altering unrelated frontmatter-like Markdown.

An external agent may forward its injected `HUABU_THREAD_ID` in the `X-Huabu-Host-Thread-Id` header. When present, the route sets `originator.threadId` and `computeChanges`, so the batch's change-review records are persisted to that host thread's `<threadId>.changes.json` sidecar and broadcast — exactly like the built-in agent path — surfacing in the conversation's change-review card. The header only correlates the conversation; authorship stays server-owned, and a malformed or absent header simply leaves the write unattributed. See [`canvas-realtime-sync.md`](./canvas-realtime-sync.md).

Commands run in order with current partial-commit semantics. The JSON response reports the effective run ID, version transition, projected commands, every command outcome, generated node and edge IDs, affected entity IDs, new node revisions, and content conflicts. It deliberately omits Web-facing deltas, pending effects, change-review records, and conflict body content — change-review records reach the Web through the sync broadcast, not this response. A stale or unread content write is a completed business result returned with HTTP 200; the caller re-downloads the node before reconciling.

## Snapshot query

`SNAPSHOT_NODES` accepts bounded node IDs plus optional output-size and sketch-stroke subset controls through `POST /query`. Passing a frame ID recursively includes every nested image and sketch descendant, so callers do not enumerate child IDs. The query delegates to the same `snapshotNodesToArtifacts()` implementation used by the built-in `snapshot_nodes` tool, so clustering, frame expansion, content-addressing, image pass-through, and partial-sketch rendering have one implementation.

The query response returns each artifact's bare `src`, public `downloadPath`, PNG dimensions, and contributing node IDs. Snapshotting may materialize a content-addressed query-cache artifact but does not mutate canvas topology or increment the canvas version. External agents can therefore obtain the user's hand-drawn sketches without invoking the optional internal agent.

## Authentication and scoping

Every operational RFS request and every focused `GET /skill/:skillId` request requires `Authorization: Bearer <AGENTLET_TOKEN>`. The global server auth hook compares the bearer value with the active Agentlet connection token, and the canvas ID embedded in `HUABU_RFS_URL` scopes route resolution to one Space.

The only anonymous exception is `GET /skill` with no Authorization header. It returns the bundled root guide without resolving the Canvas, revealing whether it exists, reading its `skill.md` override, or collecting Skill Frames. An authenticated root request resolves the override when present and appends live `skill` / `skill: <name>` Frame modules in deterministic reading order; if the additive Frame collection fails, Huabu logs the failure and still serves the root guide. A supplied invalid credential returns `401` rather than falling back to public documentation.

The shipped token grants access to the complete RFS surface, including direct reads and writes, and `/capabilities` reports both permissions as enabled. The canvas ID scopes route resolution but is not an independent credential or security boundary.

The active credential is the same high-privilege token used by the Agentlet control and relay WebSockets. It is a non-empty trimmed `HUABU_CONNECTION_TOKEN` or one random 256-bit hexadecimal value generated per Server boot, fixed at first use for the process lifetime. Historical SecretStore overrides are ignored but retained. Token editing, its configuration endpoint, and hot-switch/disconnect/restart behavior are removed. Embedded Agents receive the active token automatically; remote connections using a generated token must refresh after Server restart.

## File projection

Downloads expose only the public canvas projection: node Markdown sidecars, artifacts, and staged uploads. Private bookkeeping such as memory and history directories is rejected by the path resolver.

Node downloads return raw bytes plus allow-listed `X-Huabu-*` metadata headers. `X-Huabu-Node-Label` is percent-encoded, `X-Huabu-Node-Edges` contains compact JSON, and authored node content exposes its revision as an `ETag`. A matching `If-None-Match` returns `304`.

Uploads are inert payloads stored under `.upload/`. Names must be explicit and collision-free; the server returns `409` instead of overwriting an existing payload.

## Agent control plane

`POST /agent/:threadId/ink-intent` accepts `{ invocationToken, report }` only for the matching active external Ink turn in this Space. The report is `{ status: "inferred", text }` (one line, at most 120 characters) or `{ status: "clarify" | "unsupported" }`. The authenticated turn prompt supplies the endpoint and a fresh invocation token; this token fences stale reports and is not a substitute for RFS authentication. Completion, cancellation, and failure invalidate it. The shared Ink writer preserves manual titles and only renames the untouched pending Ink Question; the response is `{ report, renamed }`, and an inactive or mismatched turn returns `409 ink_turn_inactive`. Confirmed reports enter the normal turn event stream and durable transcript through the ACP driver's host-event drain, preserving the existing inferred-intent Chat display without invoking an internal Agent.

`POST /agent` always creates a visible Agent Node. A plain-text body uses the first selectable external Profile plus an immediate first prompt; the full JSON form optionally selects another available Profile, position, launch options, optional parent thread, and optional prompt. RFS has no access to the Web client's browser-local recent selection. Omitting `profileId` uses the first selectable external Profile without persisting that fallback. `X-Huabu-Agent-Start: false` creates an idle Agent from JSON without submitting a turn.

Parent lineage is best effort. The route resolves `parentThreadId` or `X-Huabu-Host-Thread-Id` to any Question Node in the current Space and attempts an ordinary Canvas edge after creating the Agent Node. A missing parent or rejected edge is returned as non-blocking creation metadata and never rolls back or rejects the new Agent.

`POST /agent/:threadId/prompt` addresses one existing Agent conversation directly and never creates a Node or changes its Profile. A caller that retained no creation response can query `INSPECT_NODES` for the Agent/Question Node and use its optional `threadId`; non-Question and unbound Question results omit the field. Both immediate creation and later prompts use SSE; creation streams begin with a `created` event carrying `nodeId`, `threadId`, effective `profileId`, parent-connection state, and warnings.

`GET /agent/profiles` exposes the public available Profile catalogue. It includes `huabu` as the explicit Built-In Pi choice, marks the first selectable external fallback with `default: true`, and projects Profiles to stable `id` and `alias` fields without exposing commands, working directories, manifests, setup details, or registry eligibility state. Built-In remains selectable without an external registry; its presence does not prove provider authentication. The `default` marker, not list order alone, communicates the RFS fallback.

## External-agent bootstrap

Huabu injects `HUABU_RFS_URL` and `AGENTLET_TOKEN` into the external agent environment. `HUABU_RFS_URL` is derived from the deployment-owned root `HUABU_PUBLIC_ORIGIN` plus `/api/rfs/<canvasId>`; a loopback deployment with no configured public origin uses its actual bound port as the explicit local fallback. Network binds require a non-loopback public origin before the Server listens, so a remote Agentlet never receives a success-shaped Server-local loopback URL. Every external-agent Deployment persists the bootstrap as its initial preamble, including Deployments first created by mode, model, or configuration control requests; startup repair backfills older undelivered records that omitted it. The preamble owns the authentication contract and curl header setup because every external Agent needs them before loading any Skill. The public basic guide is loaded without credentials from `GET /skill`; repeating that request with authentication adds the current root override and live Space Skill Frames. Advanced layout, Task, recursive-Agent, and Interactive View procedures are loaded on demand from authenticated `GET /skill/layout`, `/skill/tasks`, `/skill/agents`, and `/skill/interactive-views`.

Huabu injects `HUABU_SERVICE_SDK_URL`, an absolute `file://` URL for its own SDK in `packages/client-runtime/dist/service-sdk.js` or the installed `client-runtime/service-sdk.js`. Generic Agentlet protects this explicit bootstrap key against session overrides but ships no SDK itself. No old `AGENTLET_SERVICE_SDK_URL` alias or fallback exists; refresh old downloaded entries and restart Agents. Entries obtain only current configuration leases, not Package code, and provider credentials remain absent from startup environment until requested.

Agentlet accepts a generic, default-empty `bootstrapEnv` map or repeatable `--env-inject KEY=VALUE`. It copies and freezes opaque non-secret values at construction, without interpreting host names or resolving paths. Bootstrap overrides inherited values; sessions that declare any managed key or `AGENTLET_TOKEN` fail before process launch. Windows matching is case-insensitive and removes inherited case variants in the final child environment; Unix remains case-sensitive. Ordinary session context and `AGENTLET_SERVER` overrides retain their behavior.

There is no automatic `AGENTLET_REACHBACK_DIR` default or ambient resource registry. Hosts can opt in by explicitly declaring that key through bootstrap. `server/sendResource` remains available and interpolates only explicit bootstrap keys, reporting missing keys or write errors as non-fatal resource diagnostics. Bootstrap does not provision Node or gate Agent startup on optional tool availability. Control handshake rejection exits nonzero; normal supervised shutdown exits zero.

### Source and embedded launch

From a prepared Huabu source checkout, use `pnpm start:daemon` with `HUABU_PUBLIC_ORIGIN` and `HUABU_CONNECTION_TOKEN` in the process environment, the optional root `.env`, or an explicit `--env-file <path>`. Default-file connection fields are overridden by process env; an explicit file must exist and is the sole connection source. Dotenv is parsed as data, rejecting duplicate keys and malformed assignments; only the two connection fields are consumed. HTTPS derives WSS `/api/acp/agent`; HTTP derives WS plus `--allow-insecure` and an explicit plaintext warning. The launcher uses structured argv, strips the Huabu deployment namespace from the child environment, passes the token only as `AGENTLET_TOKEN`, forwards signals, and propagates child exit without a second restart loop.

The embedded path does not invoke `huabu-daemon`, pnpm, or repo env files. Server resolves the same client artifacts/bootstrap and supplies them to the existing generic supervisor, which directly forks Agentlet with the bound loopback endpoint and authoritative child credential. Desktop keeps its existing Electron Server/Agentlet process chain and does not expose an Electron Node-mode executable to Agents. Agent tool runtime choice remains independent of daemon startup. SDK/RFS coordinates are supplied only for actual local artifacts; missing optional tools do not gate embedded Agentlet or HTTP access. The RFS implementation is delivered independently of SDK migration.

Installation retains required builds but no longer modifies user shell rc or PATH. Previously installed PATH entries are left untouched.

### Optional RFS client

`packages/client-runtime/dist/rfs.js` is a self-contained optional Node entry, advertised as `HUABU_RFS_ENTRY` only when present. Run it with an Agent-selected compatible Node; Huabu neither injects a Node executable nor gates Agent startup on the client. The commands are `get-skill`, `query`, `execute`, `download`, `upload`, and `agent profiles|create|prompt`. JSON/text sources are mutually exclusive and forwarded unchanged; file `-` means stdin. `agent create --no-start` requires a JSON source and only sets the existing create-only header, leaving body validation to the Server. `execute` and `agent create` add safe `HUABU_THREAD_ID` correlation, warning if absent. Uploads stream raw bytes; logical path segments are encoded once.

Responses, including incremental Agent SSE and business failures, reach stdout unchanged. Exit zero means successful HTTP transport/normal EOF, not command acceptance or Agent business success. HTTP/local/I/O/network/TLS/detectable transport errors fail; HTTP error bodies still go to stdout. A file download is written to a sibling temporary file and renamed only after complete success; `304` preserves the target. `--dump-header` records semantic status and Fetch-normalized headers, not wire-identical traffic. The client never follows redirects, retries mutations, reconnects SSE, or cancels remote work on Ctrl+C. Ambiguous mutation failure explicitly warns to inspect state before another request.

Help retains local usage and attempts a bounded live contract request. Query/execute help uses `/capabilities`, or `/capabilities/queries/:type` and `/capabilities/commands/:type` for one specified operation; Agent help uses `/skill/agents`. An unavailable live contract is marked on stderr and help still exits zero. There is no private schema registry or offline cache presented as current. The focused authenticated `/skill/service-config` guide covers the existing lease API for an Agent's own business process without adding a provider runner or exporting credentials.

Skills explain when and how to compose workflows, but they do not duplicate the wire protocol. `GET /capabilities` and its per-operation endpoints remain the canonical, schema-derived source for current query and command fields, limits, and semantics.

The guide is direct-first: an external agent can discover, query, download, snapshot, upload, execute, and verify without creating another Agent. `POST /agent` remains an optional high-level interpretation and delegation path.

RFS errors use the normal API error body and include a runnable `/skill` recovery command so a caller can reload the current usage contract after a malformed request.

Settings > Agent > External Agent runtime > How to connect prepares a compatible source checkout with Node 24+ and pnpm, then copies `pnpm start:daemon` invocation-scoped connection env and the configured process limit. The owner explicitly chooses POSIX or PowerShell; POSIX quotes values literally, and PowerShell restores both prior process env fields in `finally`. A secondary copy action emits only public origin/token dotenv data for `pnpm start:daemon --env-file ./connection.env`; unrepresentable credentials fail rather than being changed. Owner-only `/api/acp/connection-command` validates the shell/format and browser origin, uses canonical `HUABU_PUBLIC_ORIGIN` or the validated loopback-development browser fallback, and returns no-store copy text directly to the clipboard without token rendering. HTTP/loopback warnings remain, and the launcher derives the fixed WS(S) endpoint and insecure flag. The retained `bin/start-agentlet-daemon` command name delegates to this canonical launcher without shell-sourcing `.env`, old pairing code flow, or Agent preflight.

## Interactive View resources

`GET|POST /interactive-views`, `GET /interactive-views/:nodeId`, and `PUT /interactive-views/:nodeId/state` expose Interactive Views as Web Node resources rather than a separate repository. Creation accepts a staged `upload/*.html` renderer, imports it through the canonical Canvas executor, validates that the owner is a durable external Agent thread in the current Canvas namespace, validates the closed state schema, bindings, actions, and initial value, and returns the created Node identity plus a deterministic View revision. The owner identity is `canvasId + ownerThreadId`; it does not require an Agent Node or a fixed Node binding policy. State writes replace the complete value and compare that revision inside the Canvas write mutex.

The focused `GET /skill/interactive-views` guide owns the external-Agent procedure. The iframe never receives RFS credentials or routes; its runtime bridge is described in [`web-architecture.md`](./web-architecture.md).

## Environment injection and isolation

An external agent runs as an untrusted third-party CLI. It must receive its Huabu coordinates **only through explicit injection**, never through ambient environment inheritance. Two rules enforce this:

1. **Namespace strip at the transport boundary.** When the server forks the embedded agentlet daemon, the entire `HUABU_` namespace is stripped from the inherited environment (`mountAgenetes({ hostEnvPrefix: 'HUABU_', hostEnvAllowlist: [] })`). The daemon needs none of it, so its allowlist is empty; because every agent is spawned by that daemon, the agents inherit an already-clean environment. Non-namespaced OS/toolchain variables (`PATH`, `HOME`, `TMPDIR`, …) always pass through so the agent CLI still runs. The mechanism (`filterHostNamespacedEnv`) is host-agnostic — the prefix and allowlist are Huabu policy passed in by `apps/server`.

2. **Explicit reachback injection.** Per-session `buildReachbackEnv()` supplies `HUABU_RFS_URL` and `HUABU_THREAD_ID`; the host-owned launcher bootstrap supplies SDK and available RFS entry coordinates. Inheritance is not a supported channel for Huabu configuration.

**Consequence for adding env vars:** a new `HUABU_*` variable is denied to agents by default. To expose session context, add it to `buildReachbackEnv()`; device-local non-secret tools use explicit host bootstrap. A host secret such as `HUABU_SECRET_KEY` must never be added to either; it is additionally scrubbed from `process.env` after `initializeSecretStore()` consumes it (see [`credential-storage.md`](./credential-storage.md)). This isolation only covers the `HUABU_` namespace — non-namespaced secrets a deployment exports into the server's own environment (e.g. provider API keys) are not filtered and should not be relied upon as agent-invisible.

## Code entry points

| File/dir                                                                                                                                       | Responsibility                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`apps/server/src/modules/remote_fs/rfs.route.ts`](../../apps/server/src/modules/remote_fs/rfs.route.ts)                                       | Canvas-scoped file, capability, direct-operation, and ask-agent routes.                                     |
| [`apps/server/src/modules/remote_fs/space-capabilities.ts`](../../apps/server/src/modules/remote_fs/space-capabilities.ts)                     | Compact capability handshake and schema-derived per-operation descriptions.                                 |
| [`apps/server/src/modules/remote_fs/space-execute.ts`](../../apps/server/src/modules/remote_fs/space-execute.ts)                               | Agent-friendly projection over canonical command preparation and execution.                                 |
| [`apps/server/src/modules/canvas/space-query.ts`](../../apps/server/src/modules/canvas/space-query.ts)                                         | Canonical query dispatcher over spatial and search services.                                                |
| [`apps/server/src/modules/canvas/agent-command-preparation.ts`](../../apps/server/src/modules/canvas/agent-command-preparation.ts)             | Shared server-owned authorship and built-in read-set annotation.                                            |
| [`apps/server/src/modules/canvas/snapshot-nodes.ts`](../../apps/server/src/modules/canvas/snapshot-nodes.ts)                                   | Shared node-to-artifact snapshot query implementation.                                                      |
| [`apps/server/src/modules/remote_fs/node-meta.ts`](../../apps/server/src/modules/remote_fs/node-meta.ts)                                       | Safe path projection and node metadata headers.                                                             |
| [`apps/server/src/modules/remote_fs/skill.ts`](../../apps/server/src/modules/remote_fs/skill.ts)                                               | Resolve the public bundled root, authenticated canvas override plus live Skill Frames, and advanced guides. |
| [`apps/server/src/prompt/external-agent/access-huabu.md`](../../apps/server/src/prompt/external-agent/access-huabu.md)                         | Agent-facing RFS procedure served by `GET /skill`.                                                          |
| [`apps/server/src/prompt/external-agent/service-config.md`](../../apps/server/src/prompt/external-agent/service-config.md)                     | Private in-process configuration lease procedure served by `GET /skill/service-config`.                     |
| [`packages/client-runtime/src/bootstrap.ts`](../../packages/client-runtime/src/bootstrap.ts)                                                   | Shared source/embedded artifact discovery and explicit host bootstrap.                                      |
| [`packages/client-runtime/src/daemon.ts`](../../packages/client-runtime/src/daemon.ts)                                                         | Source-checkout launcher with data-only dotenv configuration and credential-only child env.                 |
| [`packages/client-runtime/src/rfs.ts`](../../packages/client-runtime/src/rfs.ts)                                                               | Optional raw HTTP/SSE client, safe file downloads and bounded live help.                                    |
| [`apps/server/src/prompt/external-agent/layout.md`](../../apps/server/src/prompt/external-agent/layout.md)                                     | Advanced RFS adapter over the shared Space layout recipes.                                                  |
| [`apps/server/src/prompt/external-agent/tasks.md`](../../apps/server/src/prompt/external-agent/tasks.md)                                       | Durable Task and Run workflow served by `GET /skill/tasks`.                                                 |
| [`apps/server/src/prompt/external-agent/agents.md`](../../apps/server/src/prompt/external-agent/agents.md)                                     | Delegated and recursive Agent workflow served by `GET /skill/agents`.                                       |
| [`apps/server/src/prompt/external-agent/interactive-views.md`](../../apps/server/src/prompt/external-agent/interactive-views.md)               | Interactive View creation and bridge workflow served by `GET /skill/interactive-views`.                     |
| [`apps/server/src/modules/interactive-view/`](../../apps/server/src/modules/interactive-view/)                                                 | View resource validation, persistence, binding snapshots, and Agent action dispatch.                        |
| [`apps/server/src/prompt/external-agent/system-preamble.ts`](../../apps/server/src/prompt/external-agent/system-preamble.ts)                   | Render the canonical external-agent bootstrap preamble.                                                     |
| [`apps/server/src/modules/security/public-origin.ts`](../../apps/server/src/modules/security/public-origin.ts)                                 | Validate and normalize the canonical public root origin.                                                    |
| [`apps/server/src/modules/agent/acp/reachback-env.ts`](../../apps/server/src/modules/agent/acp/reachback-env.ts)                               | Derive and inject the canvas-scoped RFS environment into external sessions.                                 |
| [`apps/server/src/modules/storage/migrate-agenetes-threads.ts`](../../apps/server/src/modules/storage/migrate-agenetes-threads.ts)             | Repair persisted undelivered external Deployments that omitted the bootstrap preamble.                      |
| [`external/agenetes/packages/agentlet-host/src/daemon-supervisor.ts`](../../external/agenetes/packages/agentlet-host/src/daemon-supervisor.ts) | Fork/supervise the daemon; `filterHostNamespacedEnv` strips the host namespace at the transport boundary.   |
| [`packages/shared/src/types/api/rfs.ts`](../../packages/shared/src/types/api/rfs.ts)                                                           | Shared file-plane RFS wire schemas, headers, and constants.                                                 |
| [`packages/shared/src/types/api/space-operations.ts`](../../packages/shared/src/types/api/space-operations.ts)                                 | Canonical direct-operation request, response, capability, and limit contracts.                              |
| [`external/agentlet/spec/agent-reachback.md`](../../external/agentlet/spec/agent-reachback.md)                                                 | Host-agnostic Agentlet reachback transport contract.                                                        |
