# Executing Space commands

Use execute for deterministic mutations. Supply one JSON source as shown in local usage; stdin is supported through a file source of `-`. The Server owns scope, authorship and generated IDs. The CLI adds `HUABU_THREAD_ID` correlation when configured and warns if absent.

Load `execute --help TYPE` for required fields, constraints and examples. Submit the canonical ordered command envelope without rebuilding business schemas in the client. Inspect every result: accepted commands are not rolled back when another command fails. Use generated IDs only after receiving them, in a subsequent request when necessary.

Before changing node content, download it and use its unquoted ETag as the expected revision. Send authored Markdown only, not the server-owned leading YAML frontmatter. On conflict, reread and reconcile rather than overwriting blindly. Load `download --help` for sidecar and header handling.

Run IDs correlate requests; they are not idempotency keys. Confirm destructive, broad or difficult-to-reverse changes with the user.

{{include:external-agent/rfs-cli/common.md}}
