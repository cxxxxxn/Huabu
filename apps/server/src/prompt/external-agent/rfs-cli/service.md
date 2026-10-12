# Service Packages through the CLI

Use `service list` to discover configured Services and masked availability. A Package without External Agent support is not directly usable merely because it appears in Settings. `service manifest ID` returns metadata without credentials; `service skill ID` loads the Package's Agent-facing procedure.

Read that procedure, then use `service download ID --out-folder FOLDER`. This downloads the complete Package through the existing authenticated ZIP endpoint and extracts into `FOLDER/ID/`, retaining its top-level directory. The command prints the completed absolute directory only on success.

An existing target is an error, not overwritten. Concurrent CLI downloads of the same ID are excluded by a sibling lock. Transfer and extraction use private staging; handled failure removes staging and the lock. A process crash or forced termination can leave a lock/staging directory: inspect it and confirm no download is active before manual cleanup; the client never guesses a stale lock or retries automatically. Traversal, wrong roots, duplicate/case-colliding paths, links, encrypted/special entries and invalid checksums are rejected. Limits are 64 MiB compressed, 128 MiB expanded, 4096 entries and 4096 filesystem paths including implicit directories. Do not interpret these filesystem safeguards as a sandbox for executing Package code.

Read the downloaded `SKILL.md` and, with compatible Node, run the optional `entry.mjs --help` before invoking it. That entry's help is separate from `service --help`: it can expose provider choices and defaults from a fresh lease. The download command never executes entries, obtains configuration leases, or writes credentials.

When using your own business process instead of an entry, load `get-skill service-config` for the private in-process lease workflow. The RFS CLI is not a provider runner and has no credential-printing lease subcommand.

{{include:external-agent/rfs-cli/common.md}}
