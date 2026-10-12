# Agent control through the CLI

Use Agent operations only when open-ended interpretation, specialization or a visible durable conversation adds value. Deterministic direct Space operations do not require an internal model provider.

## Profiles

`agent profiles` returns the public catalogue. Use explicit IDs and the reported default marker, not assumptions about browser-local selection or provider readiness.

## Create

`agent create` accepts exactly one JSON/text source and creates a visible Agent Node. JSON supports Server-defined launch options; load `get-skill agents` for the full contract. Create-only requires JSON and the no-start option. The client forwards bytes unchanged and supplies the existing create-only and host-thread headers without rewriting JSON.

## Prompt

`agent prompt THREAD_ID` continues one existing conversation without creating another Node or changing its Profile. Retain the thread ID from creation; if lost, inspect the Agent/Question Node and use its existing thread association. An absent association is not a reason to silently create a new Agent.

## Streaming

Creation/prompt delivery is raw incremental SSE. Inspect creation metadata, warnings and business events; normal EOF does not imply a done event or successful work. Closing local delivery does not cancel the durable remote turn. Load `get-skill agents` when launch configuration, parent lineage or recursive delegation is required.

{{include:external-agent/rfs-cli/common.md}}
