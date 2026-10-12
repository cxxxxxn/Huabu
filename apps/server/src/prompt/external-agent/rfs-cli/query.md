# Querying the Space

Use query for bounded discovery, search and snapshots without starting an internal Agent. Choose one JSON source from the local usage; a file path of `-` reads stdin. Bytes are forwarded unchanged and the Server validates the query.

The live catalogue identifies available operation types. Load `query --help TYPE` before constructing an unfamiliar operation; its schema, constraints, result and examples are authoritative. Inspect truncation metadata and narrow the query rather than assuming the first page covers the Space.

Keep full node bodies and artifacts out of metadata queries: download the exact returned paths. To see image/sketch/frame content, load the `SNAPSHOT_NODES` contract; a frame recursively covers supported descendants. Use returned geometry for placement rather than guessing from labels.

{{include:external-agent/rfs-cli/common.md}}
