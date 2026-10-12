# Downloading Space files

Pass the exact logical path supplied by selected-node context or a query. Do not pass a URL or pre-encode path segments; the CLI encodes each segment once. No directory listing is available.

Use the output option to save bytes; successful transfers replace the target only after complete receipt. A matching conditional ETag returns 304 and leaves the target untouched. HTTP errors reach stdout, not the file target; transport failures leave an existing target unchanged.

Use the header-dump option to retain semantic status, ETag and allow-listed node metadata. Headers are Fetch-normalized, not a wire-identical capture. Node label headers are percent-encoded. Header and content output paths must differ.

A node Markdown download is a complete sidecar: server-owned YAML frontmatter followed by authored content. Before an execute content update, remove exactly that leading frontmatter block and preserve the authored body; use the downloaded revision for conflict protection.

{{include:external-agent/rfs-cli/common.md}}
