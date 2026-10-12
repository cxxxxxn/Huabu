# Uploading staged bytes

Upload an explicit unique name using a file path or stdin (`-`). The client streams raw bytes. Do not use a URL, traversal or a name containing path separators.

An upload is inert: inspect the returned staged path and reference it in an appropriate subsequent operation. Existing names are not overwritten; a collision is a business/API error to resolve with a new name, not an automatic retry. Use execute capability detail to construct a node that references the upload.

{{include:external-agent/rfs-cli/common.md}}
