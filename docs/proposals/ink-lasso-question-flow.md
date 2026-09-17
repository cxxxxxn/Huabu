# Ink Lasso Question Flow

> Status: **Proposed** · Last updated: 2026-09-17

## 1. Summary

Huabu should let a user lasso handwritten Sketch strokes together with optional Canvas nodes and explicitly submit that bounded selection as an Agent request. The selected Ink is a source that carries the user's intent. New tasks use the built-in Huabu `operate` Agent to infer that intent from the partial-stroke image and execute it through the existing Agent and Canvas toolchain; an existing Question thread retains its internal or external binding and effective mode.

The V1 flow reuses the existing Lasso gesture, retained stroke selection, partial-stroke snapshotting, Question Node lifecycle, Agent request pipeline, and Chat history. It does not add a second pointer engine, a separate Ink runtime, OCR, an intent-recognizer model call, or an Ink-specific execution backend. The executing Agent may publish one structured inferred-intent summary from the same turn so the generated Question and Ink history row become understandable without pretending the user typed that text.

The earlier interactive HTML concept was a visual exploration and is not included in this branch. This Markdown proposal is the self-contained implementation contract and records the deliberate differences from that concept in §3.

## 2. Goals

1. Turn an existing retained Lasso selection into an explicit, inspectable Agent submission.
2. Require at least one selected Sketch stroke so every V1 submission has an Ink intent source.
3. Let ordinary selected Canvas nodes accompany the Ink as additional sources.
4. Create a visible Question Node for a new task or continue one existing Question thread when the selection names it.
5. Let the Question's bound Agent infer a clear intent and act through its existing capabilities, or ask a focused clarification question when the intent is materially ambiguous.
6. Reuse Huabu's existing material-consistency boundary: materialize visual sources while building the envelope, persist canonical rendered inputs, expose revisions on referenced nodes, and protect Agent writes through read-set CAS.
7. Keep Chat available through the Question Node without opening it automatically for a normal submission.
8. Reuse one Agent-turn pipeline for Chat and Lasso submissions so lifecycle, persistence, streaming, cancellation, and error behavior cannot drift. Question anchoring is an optional capability of that pipeline, not a requirement imposed on ordinary node-less Chat.
9. Preserve the visible relationship between submitted Ink and selected Canvas objects through a hidden grounding image captured at the user's current zoom and text-detail level.
10. Replace generic Ink placeholders with a concise Agent-inferred intent when the executing Agent reports one, while preserving the original Ink provenance and every user-authored rename.

## 3. Approved V1 Product Decisions

| Topic                               | Decision                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intent inference                    | The Question's bound Agent interprets Ink in the same turn. New tasks use built-in `operate`; existing tasks retain their internal or external binding and effective mode. There is no separate intent-model call.                                         |
| Ambiguous Ink                       | The Agent does not guess an operation; it asks one focused clarification question in the Question thread.                                                                                                                                                  |
| Submission requirement              | At least one selected Sketch stroke is required. Ordinary nodes are optional additional sources.                                                                                                                                                           |
| Source language                     | The UI calls every included item a `source`; it does not expose separate intent/reference categories.                                                                                                                                                      |
| No Question Node selected           | Create a Question Node below the selection with collision avoidance, keep Chat closed, and start immediately. An open Preview/Chat Question is not an implicit target.                                                                                     |
| One Question Node selected          | Continue the Question/Agent Node actually selected by this Lasso, inherit its internal or external binding and effective mode, and exclude the Question Node itself from sources.                                                                          |
| Two or more Question Nodes selected | Disable submission and ask the user to narrow the selection. V1 does not merge threads or ask the user to choose a target.                                                                                                                                 |
| New Agent binding                   | New tasks use the built-in Huabu `operate` Agent. V1 has no Agent/Profile picker.                                                                                                                                                                          |
| New node title                      | Show `New ink request` while inference is pending. The first successful built-in Ink turn may replace only that untouched placeholder with its structured inferred intent; existing Question titles and user-renamed nodes never change.                   |
| Submission UI                       | Extend the existing `StrokeSelectionToolbar`; do not add a second floating toolbar or remove current stroke-editing actions.                                                                                                                               |
| Agent target feedback               | Place a compact Agent target hint beside the source count. No selected Agent Node displays `New · Huabu`; one valid selected Agent Node displays its bound Agent name; multiple or invalid targets display the corresponding blocked state.                |
| Mixed Ink grounding                 | A mixed Ink/object submission includes a hidden visual grounding image of the relevant visible Canvas region. It preserves the current viewport zoom, node LOD, text truncation, and Ink/object placement instead of re-rendering hidden detail.           |
| Grounding presentation              | The grounding image is Agent input, not a user attachment or source. ChatPanel never renders its thumbnail, filename, attachment row, or source chip, and it does not change the source count.                                                             |
| Inferred intent presentation        | A structured inferred intent becomes the primary text of that Ink row and may name its newly created Question. It remains Agent-derived metadata, never user-authored `content`; the Pen affordance preserves Ink provenance.                              |
| Missing or ambiguous inference      | Keep the generic `Ink request` / `New ink request` presentation. Clarification remains an assistant response, and Huabu never derives intent by parsing arbitrary reply text.                                                                              |
| Request semantics                   | Persist a structured `ink-intent` marker. Do not pretend the user typed a synthetic text message.                                                                                                                                                          |
| Successful submission               | Clear the retained Lasso selection only after the server accepts the turn. The original Canvas content remains.                                                                                                                                            |
| Failed submission                   | A rejection before acceptance keeps the selection and any created Question for retry. A transport failure with unknown acceptance requires reconciliation before resubmission. An accepted turn's later runtime failure uses normal Chat recovery.         |
| Consistency                         | Reuse Huabu's existing split semantics: visual sources are materialized for the turn, ordinary nodes remain revisioned live references, and Agent content writes use read-set CAS. Never widen a fully stale partial Sketch selection to the whole Sketch. |

### 3.1 Differences from the HTML concept

The V1 product contract differs from the HTML concept in these deliberate ways:

- Voice input is absent, including the microphone affordance, recording state, transcription, and audio protocol.
- Selected Ink counts as a source. A selection containing one partial Sketch plus a PDF and a Note displays three sources.
- The submit action lives in the existing stroke-selection toolbar instead of a separate submit pill.
- Two or more Question Nodes block submission instead of creating a synthesized task.
- New tasks always use the built-in Huabu `operate` Agent.
- Existing Question targets retain an explicitly selected external Agent rather than being rebound to Huabu.
- New nodes initially display `New ink request`; a same-turn structured inferred intent may replace that untouched placeholder without a separate title-model call.
- Mixed Ink/object requests add a hidden WYSIWYG relationship image; they do not expose that derived image as a Chat attachment.

## 4. Non-Goals

V1 does not include:

- voice recording or transcription;
- OCR or durable recognized text for Sketch strokes;
- a standalone intent recognizer or utility-model role;
- an intent preview or confirmation step before execution;
- general-purpose automatic Question naming, parsing the Agent's prose for a title, or overwriting a user-authored title;
- an Agent/Profile picker in the Lasso toolbar or automatic rebinding of a target Question;
- a new ACP vision-capability negotiation protocol;
- multi-Question synthesis, thread merging, or target selection;
- handwritten sigils, capability palettes, Skill pinning, or task-level approval configuration;
- changes to Lasso hit-testing, pointer ownership, stroke movement, split/merge, erase, or undo behavior;
- a server-rendered or force-zoomed "ideal" node screenshot that reveals text/detail absent from the user's current Canvas LOD;
- a new Agent endpoint or a second SSE protocol.

## 5. Existing Architecture to Reuse

| Existing surface                                                                                                        | Current responsibility                                                                                                     | V1 use                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`gesturePreviewStore.ts`](../../apps/web/src/store/gesturePreviewStore.ts)                                             | Holds transient `sketchStrokeSelection` as `nodeId -> strokeIds` and clears Canvas-scoped previews.                        | Source of the retained partial-stroke selection; cleared only after accepted dispatch.                         |
| [`StrokeSelectionToolbar.tsx`](../../apps/web/src/components/Panels/Canvas/FloatingToolbars/StrokeSelectionToolbar.tsx) | Anchors stroke style/delete actions and arbitrates the single floating toolbar.                                            | Adds source count, blocked-state explanation, and submit action.                                               |
| [`agent.ts`](../../packages/shared/src/types/api/agent.ts)                                                              | Defines and validates `/api/agent` request context and `WireSelectionNode.strokeIds`.                                      | Adds only the durable Ink-submission semantic marker; source identity keeps its existing shape.                |
| [`envelope.ts`](../../apps/server/src/modules/agent/conversation/envelope.ts)                                           | Enriches selected nodes with previews/revisions and auto-snapshots selected Sketch/image nodes, including `strokeSubsets`. | Builds the point-in-time partial-stroke visual source and revisioned material refs without a new capture path. |
| [`build-prompt.ts`](../../apps/server/src/modules/agent/conversation/prompt/build-prompt.ts)                            | Renders one canonical text/image input sequence for built-in and ACP backends.                                             | Injects the host-owned Ink-intent directive for a structured `ink-intent` turn.                                |
| [`useAgentStream.ts`](../../apps/web/src/hooks/useAgentStream.ts)                                                       | Owns Question lifecycle, request scope, Agent binding, SSE, history, cancellation, and refresh.                            | Supplies behavior to the shared Agent-turn controller, retaining ordinary node-less Chat support.              |
| [`questionCompose.ts`](../../apps/web/src/components/Nodes/question/questionCompose.ts)                                 | Centralizes Question Node/thread creation and compose entry.                                                               | Supplies the canonical node/thread creation primitives without opening compose.                                |
| [`screenshot.ts`](../../apps/web/src/handler/canvasCommand/utils/screenshot.ts)                                         | Rasterizes the rendered React Flow Canvas DOM while preserving its current visual state.                                   | Supplies the canonical capture primitive for a cropped visible-Canvas grounding image.                         |
| [`agent-node-freshness-cas-plan.md`](./agent-node-freshness-cas-plan.md)                                                | Defines node revision signals, read-before-write, the per-session read-set, and executor CAS.                              | Remains the only content freshness and write-conflict mechanism for referenced materials.                      |
| [`question-node.md`](../architecture/question-node.md)                                                                  | Defines Question ownership, anchoring, lifecycle, and neighbourhood context.                                               | Remains the task and conversation model.                                                                       |
| [`sketch-node.md`](../architecture/sketch-node.md)                                                                      | Defines retained Lasso selection and partial-stroke AI context.                                                            | Remains the Ink selection and visual-source model.                                                             |

The key architectural fact is that partial Ink is already a first-class Agent source. `WireSelectionNode.strokeIds` persists with the request and `snapshot_nodes` accepts a KEEP-list. The snapshot implementation rejects a non-empty KEEP-list that no longer matches any stroke rather than rendering the whole Sketch, but the current envelope builder catches snapshot failures and continues without the image. V1 must propagate missing required Ink visuals through the shared preparation path; request rejection is a requirement, not existing behavior. V1 adds submission intent and routing, not another Ink representation.

## 6. Interaction Contract

### 6.1 Readiness

The toolbar derives a submission candidate from one coherent Canvas snapshot:

```text
retained stroke selection
        +
selected whole nodes
        |
        v
capture source ids and classify Question targets
        |
        +-- no Ink --------------------------> hidden or disabled
        +-- 2+ Question Nodes --------------> disabled: narrow selection
        +-- invalid Question target ---------> disabled: repair target
        +-- 0/1 valid Question target -------> ready
```

The presence of at least one non-empty `strokeIds` array is the V1 intent gate. A whole Sketch selected through ordinary Select does not satisfy this gate because it does not identify the Ink the user is submitting as the request.

Every included non-Question selection member uses the existing source-count contract. A partial selection from one Sketch node is one source regardless of its stroke count. The routing Question Node is an anchor, not a source, and is removed from the outbound selected-node list exactly as current anchored Chat already does.

Question targeting is exclusively Canvas-gesture-owned. The target set comes from the current Lasso's whole-node selection; the active Preview Workspace tab, open Chat thread, and most recently viewed Question never act as fallbacks. At collapsed zoom, a Question/Agent Node is hit-tested against the visible takeover mark's blended Canvas-space rectangle rather than the faded React Flow card footprint, so circling the Agent mark selects the node the user can actually see.

### 6.2 Toolbar behavior

`StrokeSelectionToolbar` remains the only floating surface for a retained stroke selection.

- The submit action and source count appear for pure and mixed selections on mouse, pen, and touch.
- A compact Agent target hint appears in the same toolbar metadata cluster as the source count. It indicates whether this Lasso includes a routing Agent Node and is not included in the source count.
- With no selected Agent Node, the hint reads `New · Huabu`, communicating that submission will create a new Question bound to the built-in Agent. With exactly one valid selected Agent Node, it shows that Question's effective bound Agent display name, including an external Agent Profile name when applicable; it never substitutes the Question title.
- With multiple selected Agent Nodes or one invalid target, the hint shows the matching blocked state instead of an Agent name, and the send control remains disabled. Long Agent names truncate without resizing the toolbar and expose the complete name through a tooltip and accessible label.
- Existing color and size controls remain available only for a pure stroke selection.
- Existing touch delete behavior remains available.
- Mixed desktop selection no longer makes the toolbar disappear: it suppresses style controls but retains the submit action.
- The send control uses the shared `Button`/`FloatingToolbar` primitives and a Lucide send icon, with an accessible label and disabled-state explanation.
- Pointer-down inside toolbar controls must not start a stroke move or a new Lasso gesture.
- Repeated activation while the same turn is submitting is ignored.

### 6.3 New task

When this Lasso selected no Question Node, the client creates one Question Node and one thread before dispatch:

1. Compute the absolute bounds of the retained stroke and whole-node selection.
2. Choose a point below those bounds using the existing placement and collision-avoidance helpers.
3. Create a Question Node with a fresh node ID and thread ID, the built-in Agent binding, `operate` mode, the V1 placeholder `New ink request`, and an explicit pending-inferred-label marker. A user rename clears that marker.
4. Await a success-reporting form of the existing Canvas save boundary so the server can resolve the new anchor and selected Ink. Reuse the structure scheduler and node-content queue behind `drainPendingSaves()`; its current navigation-oriented promise settles even on save failures, so awaiting it alone does not prove persistence. Keep the action-log `flushCanvasEvents()` separate. Do not use a timer or a second save implementation.
5. Dispatch the structured Ink turn with the new node as `anchorNodeId` and keep the Preview Workspace closed.

The Question Node's position gives the Agent the normal bounded neighbourhood. Nearby Canvas nodes are ambient context only; they do not become selected sources unless the user lassoed them.

### 6.4 Existing task

When exactly one Question/Agent Node selected by this Lasso owns a valid thread, that node becomes the conversation owner and `anchorNodeId`. The turn inherits its persisted or pre-first-turn cached binding and effective mode. This includes a newly created selectable Question whose user explicitly chose an external Agent before its first send. The target node is excluded from selected sources, while the selected Ink and ordinary nodes become the new turn's sources.

For internal bindings, inheritance includes `ask`: it interprets the handwritten request using its normal read-only tool set and does not become `operate` merely because the input is Ink. New tasks still start in `operate`. External bindings retain their existing ACP session and capability surface; Ink submission does not silently rebind them or invent an internal mode.

External ACP delivery is explicitly best effort in V1. Huabu's canonical renderer already carries the required partial-stroke image as an ACP image content block, and external Agents already receive Canvas-scoped RFS read/write access. Huabu does not yet have a reliable ACP/Profile field that proves the selected Agent's underlying model supports vision, so the toolbar must not claim compatibility or silently switch models. An Agent that cannot process the image follows its existing error or clarification behavior; the Question and retained selection remain available when the request is rejected before durable acceptance.

### 6.5 Completion and clarification

The bound Agent receives a host-owned directive equivalent to:

```text
Treat the selected Sketch strokes as the user's request. Infer the intended task from the Ink and the other selected Canvas sources, then respond using the current mode and its available tools. In operate mode, execute a clear task. In ask mode, answer within its read-only capabilities. If the intended task is materially ambiguous, do not guess; ask one focused clarification question.
```

This directive is product policy, not OCR output and not Canvas-authored text. The selected Ink remains user content and cannot override higher-level safety, permission, or tool policy.

A clear request follows the normal `running -> done/error` lifecycle. An ambiguous request completes the turn with a clarification question; the Question Node's unread terminal-state affordance leads the user into the existing Chat UI. V1 does not introduce a separate `clarifying` node status.

Existing permission requests remain authoritative. Ink submission never enables auto-approval or bypasses a configured approval boundary.

### 6.6 Visible Canvas relationship grounding

A mixed selection containing Ink plus at least one ordinary non-Question Canvas object requires a relationship grounding image in addition to the existing partial-stroke visual and node refs. The partial-stroke image answers "what Ink was submitted" and the node refs/read path answer "what the objects contain"; the grounding image answers "where the Ink landed relative to the visible object and its currently visible internal elements." Without this third signal, an arrow aimed at one visible list item can be misread as an instruction to resize or rewrite the whole node.

The Web client captures the grounding image from the rendered Canvas DOM at activation time, before asynchronous save/Question creation can alter the scene. Its semantic content must match what the user could see at that moment:

- preserve the exact current viewport transform, zoom-derived node LOD, visible text hierarchy, truncation, clipping, collapsed Agent marks, and relative Ink/object geometry;
- crop the union of the submitted strokes and selected ordinary objects, intersected with the visible viewport and padded enough to retain arrow shafts, underlines, and nearby target context;
- include user-authored Canvas content and Ink, but suppress transient application chrome such as the floating toolbar, selection outlines, resize handles, ports, retained-Lasso dashes, hover effects, and the newly created Question Node; suppressing chrome must not change node layout or LOD;
- never force zoom, expand a node, substitute canonical full text, re-render at another breakpoint, or include off-screen/hidden detail. Raster scaling may resize pixels for transport, but it must not cause the DOM to choose a different detail level;
- record the capture's viewport, zoom, crop rectangle, device-pixel ratio, selected ordinary node IDs, and stroke subsets so the model-facing caption can distinguish relation evidence from canonical object content.

The grounding visual defines interpretation granularity. At a zoom where only a node shell/title is visible, the Agent may infer only node-level pointing. At a zoom where a particular paragraph, list item, or diagram label is visibly rendered, the Agent may use the Ink landing position as evidence for that visible sub-element. The Agent still reads canonical node content through `read()` and exact geometry through `inspect_nodes()`; those channels may explain the selected object but must not retroactively manufacture a more precise visual target than the grounding image shows.

The request carries this image in a dedicated grounding field rather than `attachments`, `imageAttachments`, or the user-visible source projection. The canonical renderer wraps it as host-labelled user-content evidence equivalent to "Visible Canvas relationship at submission zoom" and sends it to built-in and external Agents as an image part. It remains untrusted Canvas content, cannot override host/tool policy, and must not be described as a file the user uploaded.

The grounding image is deliberately invisible in ChatPanel. Optimistic messages and durable history continue to show only the Ink request row, actual source chips, stroke counts, and user attachments. They do not show a grounding thumbnail, filename, attachment count, source chip, hover target, download action, or placeholder. The image and its capture metadata persist inside the turn envelope/canonical `AgentSubmission.rendered` input so reconnect and replay deliver the same model input without exposing a second user-visible message artifact.

### 6.7 Inferred intent presentation

The generic `New ink request` Question label and `Ink request` Chat row are pending-state fallbacks, not the final description when the executing Agent can state what it understood. Commit 6 adds one structured, hidden intent-reporting primitive to the existing turn rather than a second inference call. For built-in Ink turns, the host makes `report_ink_intent` available as a narrow internal tool and the Ink directive asks the Agent to invoke it once, before acting or asking for clarification:

```ts
type InkIntentReport =
  | { status: 'inferred'; text: string }
  | { status: 'clarify' | 'unsupported' };
```

`text` is trimmed plain text, one line, contains no Markdown, and is bounded to a concise display length. It describes the actionable interpretation rather than narrating recognition, for example `Expand the third comparison step in the left note`. The tool invocation and validated payload are persisted inside the same Agent turn but are hidden from ordinary tool-call rendering; live and history projections expose only a typed `inferredIntent` field on the corresponding Ink user item. Huabu never extracts this field from assistant prose, plans, `session_info_update.title`, tool side effects, or the Question label.

The ChatPanel preserves authorship honestly. Before a valid report arrives, the row shows the existing localized `Ink request` fallback. After an `inferred` report, the inferred text becomes the row's primary text while the Pen icon and accessible description identify it as an Agent interpretation of Ink. The original user `content` remains empty and immutable, the hidden grounding image remains invisible, and source chips/attachments are unchanged. `clarify`, `unsupported`, a missing report, malformed text, or an Agent error leaves the fallback in place.

Only a Question created by this Ink attempt is eligible for automatic naming. The server resolves the reporting turn's authoritative Question owner and updates its label through the canonical Canvas executor only when the node still carries the pending-inferred-label marker and its label remains the untouched placeholder. The patch writes `labelSource: 'agent'`, clears the pending marker, and never writes the inferred text into `QuestionNodeData.content` or `responseSummary`. Existing Question targets are thread titles rather than per-turn summaries and are never renamed; a user rename wins even if it races with the report.

The folded turn retains the validated report so history hydration and conversation search can project the same inferred text without rerunning a model or reading the current Question label. Each Ink follow-up owns its own report. Reconnect observes the already persisted report; an explicit retry creates a new turn whose row begins with the fallback and may receive a new report, while the original turn keeps its original interpretation.

External ACP Agents do not currently have an authoritative host intent-reporting capability. Their Ink turns therefore keep the generic fallback unless a future ACP capability exposes the same validated structured primitive; Huabu must not repurpose ACP session titles or parse external reply prose. Full external parity requires a later ACP contract or a separately approved preflight inference call, neither of which blocks external Ink execution itself.

## 7. Durable Request and Material Consistency

### 7.1 Structured submission kind

The shared `/api/agent` request schema gains a backward-compatible structured marker. The exact schema should remain zod-first in [`packages/shared/src/types/api/agent.ts`](../../packages/shared/src/types/api/agent.ts); web code imports only inferred types.

Conceptually:

```ts
type AgentInputKind = 'text' | 'ink-intent';

interface AgentRequestInput {
  inputKind?: AgentInputKind; // absent means legacy text
  content: string;
  groundingVisual?: VisibleCanvasGrounding;
}
```

Validation rules:

- absent or `text` requires non-empty `content`, preserving current behavior;
- `ink-intent` permits empty `content` but requires Canvas context with at least one partial Sketch selection;
- `ink-intent` accepts internal and external bindings; new tasks use built-in `operate`, while existing targets preserve their authoritative binding and effective mode;
- the complete kind and captured source list persist in the existing durable submission, not in a second Ink request store;
- durable recovery/replay consumes stored rendered input without rendering against a newer Canvas; the currently unimplemented HTTP fork operation is not added by this feature.
- `groundingVisual` is accepted only for `ink-intent`, is required when the captured selection contains at least one ordinary non-Question object, and is validated as a bounded Canvas screenshot plus capture metadata; it is never projected as a Chat attachment/source.

For an external Agent, the live ACP `session/prompt` carries the same required image blocks as the persisted rendered submission. If Agenetes cannot resume the native ACP session and must reconstruct earlier turns through its text-only history channel, historical image bodies become explicit `image omitted` placeholders. This makes the loss visible but cannot guarantee that every external Agent asks for resubmission; a follow-up that depends on omitted Ink may require the user to submit the relevant strokes again. V1 does not claim image-faithful ACP fallback replay and does not disable an otherwise usable live external turn because of that recovery limitation.

`ChatEnvelope.user` carries the normalized input kind so prompt rendering and transcript projection do not infer behavior from empty text or node types. The transcript renders an Ink request row plus normal source chips and stroke hover re-highlighting. It does not render the host directive as if the user typed it.

The inferred intent is a turn result, not request content. It is persisted from the validated `report_ink_intent` call in the folded turn and projected into `ChatHistoryItem.inferredIntent`; it is never inserted into `ChatEnvelope.user.text`, `QuestionNodeData.content`, `responseSummary`, or the immutable submitted grounding image.

### 7.2 Reuse the existing submission boundary

Ink submission does not add client-authored revision fields or a second all-or-nothing material validation protocol. It reuses the same server-owned boundary as ordinary Huabu Chat:

1. `/api/agent` resolves the effective thread and binding, then builds one `ChatEnvelope` before invoking the Agent.
2. Envelope construction reads selected-node records from the canonical store, emits metadata refs with their current `rev`, and materializes selected Sketch/Image visuals through `snapshotNodesToArtifacts()`.
3. The Agent service renders that envelope into canonical `AgentInput[]` before `handle.run()` and stores those inputs in `AgentSubmission.rendered` with the turn.
4. Replay consumes the stored `rendered` inputs byte-for-byte, including image parts, instead of rebuilding them against the current Canvas.

This gives each source kind the same temporal semantics it already has in Huabu:

| Source kind                      | Turn-time behavior after the user submits                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected Ink / Sketch visual     | The server renders the selected `strokeIds` into the turn's image artifact while building the envelope. Later Canvas edits do not alter the persisted rendered input. An unmatched non-empty KEEP-list fails snapshotting instead of widening to the whole Sketch. V1 must additionally stop an Ink-intent turn when required visual preparation fails; the current envelope builder treats snapshot errors as best-effort omissions. |
| Selected Image visual            | The server resolves the selection visual into the canonical rendered input; replay does not resolve the current node again.                                                                                                                                                                                                                                                                                                           |
| Uploaded or excerpted attachment | Its submitted content is rendered and persisted with the turn.                                                                                                                                                                                                                                                                                                                                                                        |
| Selected Note/PDF/Web/other node | The envelope stores a metadata ref with `file`, preview, and `rev`, not a full body snapshot. If the Agent needs the body, `read()` returns the latest canonical content and its current revision.                                                                                                                                                                                                                                    |
| Mixed Ink/object grounding       | The browser captures the visible relationship at the activation-time viewport/LOD and the server persists it as a hidden canonical image part. It provides pointing evidence only; canonical object content still comes from refs and `read()`.                                                                                                                                                                                       |

The selected Note/PDF/Web/other-node row is intentionally a live-reference contract. If a user edits an ordinary selected material after submitting but before the Agent first reads it, the Agent reads the newer content. Huabu surfaces the envelope revision and fresh read revision so the change is observable; V1 does not fork or duplicate the node merely to preserve the earlier body. The grounding image remains the point-in-time visual evidence of what was visible when the gesture was submitted.

Capturing source identities is not an atomic material snapshot at click time: metadata, neighbourhood, and images are read during separate server preparation steps. The client captures IDs and stroke KEEP-lists consistently, while the existing server determines their materialized content.

### 7.3 Reuse read-set CAS for write conflicts

Reading a node through the built-in `read()` tool records its current revision in the thread's session read-set. Any later Agent-authored content mutation receives `expectRev` from that read-set at the `canvas_commands` boundary. The executor rejects two unsafe cases through the existing structured conflict result:

- `not-read`: the Agent attempts to rewrite authored content it did not read;
- `stale`: the user or another turn changed the node after the Agent read it.

The Agent then re-reads, reconciles, and retries through the existing tool loop. The Ink feature must not add a bypass, a parallel expected-revision field, or toolbar-owned conflict resolution. Geometry and structure continue to follow their existing command/realtime-sync semantics because content revisions deliberately exclude those fields.

The selected Question target is still resolved server-side from the current thread ownership and binding rules. Existing conversation-integrity validation remains authoritative; the Ink path does not duplicate it in the selection wire.

## 8. One Shared Agent-Turn Pipeline

The current `useAgentStream.startStream()` combines Chat input collection, optional Question lifecycle, and turn execution. It rejects empty text and reads selection at multiple points around asynchronous work. Calling it unchanged from a hidden Chat instance, or calling `/api/agent` directly from the toolbar, would preserve the wrong ownership boundary.

Extract the existing implementation into a component-independent, thread-scoped controller with two thin input adapters. Keep ordinary node-less Chat, anchored Chat, and cross-Canvas conversation ownership working through the same path. This is a focused extraction, not a new Agent framework or a migration of all Question lifecycle ownership to the server.

```text
Chat composer -> text/skills/uploads + captured Canvas sources
Lasso adapter -> ink-intent + captured Canvas sources + Question target
                                                                              |
                                                      shared turn controller
                                                                              |
                                                 existing Agent API/SSE
                                                                              |
                                          envelope -> rendered input -> Agent
```

### 8.1 Explicit input, shared normalization

Only the input payload discriminates text from Ink. Sources, attachments, owner, mode, settings, and stream options remain common controller arguments using existing shared types. Do not introduce an Ink-only equivalent of `AgentChatContext`, `ChatSession`, `ChatEnvelope`, or `AgentSubmission`.

- Capture source node IDs and stroke IDs before the first asynchronous validation or Question creation. Extract or parameterize the serializer behind `getAgentChatContext()` so both adapters use its partial-stroke merging and recursive Frame handling. Derive wire context, optimistic history metadata, and source count from that same captured selection.
- For a mixed Ink/object submission, capture the visible-Canvas grounding bitmap and metadata from the same synchronous selection/viewport snapshot. Keep it outside Chat drafts, pending attachments, source count, optimistic attachment rows, and source chips.
- Captured selection fixes membership, not content revisions. Do not reread the active Canvas selection later to decide what this turn includes. Server materialization retains §7 semantics.
- The Chat adapter owns draft consumption, slash-command parsing, staged uploads, and the shared text-excerpt attachment. Preserve its current UI behavior during extraction. The Lasso adapter supplies no such extras in V1 and must neither consume nor clear another composer's draft, uploads, excerpt, or invoked skills, even when that composer shows the same target thread.
- Resolve the target's binding, mode, model, and reasoning settings through the existing conversation/thread mechanisms. New Ink tasks explicitly select internal `operate` and otherwise use ordinary built-in defaults. Existing targets retain their own cached or persisted internal/external binding; they never inherit an unrelated active tab's Profile or settings.
- Keep presentation-only guards, such as whether a submitting Chat tab still exists, in the adapter. Keep owner integrity and Canvas scope validation shared; a background caller must not need a fabricated Preview tab.

### 8.2 Reuse Map and Ownership

| Concern                   | Existing owner to reuse                                                                 | Required shared boundary                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation identity     | `conversationOwner.ts`, `ChatSession`, Preview Workspace                                | Use owner Canvas/node/thread, not active UI globals. Preserve World/headless selection exclusion; V1 does not introduce cross-Canvas Ink source transfer.                                    |
| Sources and source chips  | `canvasStore.getAgentChatContext()`, `WireSelectionNode`, transcript selection fields   | One serializer and one source projection for both inputs, including Frame children and stroke KEEP-lists. The Question anchor is not a source.                                               |
| Settings and binding      | `chatStore` thread selectors, conversation binding resolution, server thread settings   | Retain first-send locking, fixed-owner authority, and compose-cache handoff. Ink adds no settings store or model-routing policy.                                                             |
| Duplicate dispatch        | `agentStreamCoordinator.ts`, per-thread loading, `AgentThreadService` lease             | Reuse the same Canvas/thread claim for POST and attach, including sends initiated from another surface. Busy rejection remains `thread_busy`; a lease is not request idempotency.            |
| Saving before preparation | Existing structure scheduler and node-content queue behind `drainPendingSaves()`        | Add a success-reporting submission barrier in the save layer, used by both adapters. Preserve navigation's non-rejecting drain behavior. Keep behavioral-event flushing separate.            |
| Question lifecycle        | `questionCompose.ts`, `conversationOwner.ts`, existing fixed/selectable lifecycle split | Extract create-without-opening from compose creation; reuse binding, running/error/done, viewed/unread, and owner refresh. Do not copy lifecycle code into the toolbar.                      |
| Stream and cancellation   | `agentApi`, `handleStreamEvent`, stream coordinator                                     | One event reducer and one stop path. Stream ownership outlives Chat mount; closing a tab is not stopping the Agent. Opening Chat during an Ink run must not create a duplicate subscription. |
| History and recovery      | `useChatHistory`, shared transcript projection, existing stream attach                  | Preserve rendered submissions, event replay, history loading, settings restoration, and deduplication through existing paths. Do not add Ink-only history hydration.                         |
| Retry                     | Current Chat retry action and shared user-message metadata                              | Replace text-only resubmission with a typed retry descriptor derived from the submitted input. Both text and Ink use this one retry path; see §9.                                            |
| Tools and context         | Existing envelope/renderer, memory, skills, Space Prompt realization, tool policy       | Input kind changes only turn interpretation and required-input validation. No second system prompt, tool loop, memory scope, approval policy, or automatic Skill inference.                  |
| Feedback and changes      | Existing Question mark, Chat messages, permission tray, thread change-review store      | Feed the same stores and reuse their presentation. Preserve all event kinds during extraction, including ACP permission and change-review behavior.                                          |

### 8.3 Controller Lifetime and Question Creation

The shared controller is callable without React mounting. Reuse or extend the module-level stream coordinator rather than adding a parallel Ink controller registry. Chat hooks subscribe to thread state and delegate sending/stopping; the Lasso adapter calls the same service. A newly opened Chat can stop a run started from the Canvas. Unmounting the initiating toolbar or closing a tab cannot discard its lifecycle callbacks or turn state.

Split `createQuestionNodeAndCompose()` into a canonical create/initialize primitive plus the existing open/focus effect. Existing Chat and placement callers retain their behavior. The Ink caller uses the create-only primitive with an explicit binding/mode. Selection geometry and collision-aware placement stay in the Canvas layer and never enter the stream controller.

`New ink request` is a pending display label, not authored `content` and not a synthetic first user message. Ink first-send initialization skips the textual content write that triggers Question label generation. Reuse the normal non-idle lifecycle and first-turn binding rules so an empty-content Ink Question is not repeatedly treated as a new compose session. Only the structured §6.7 report may replace the untouched placeholder; do not add a separate `inkRunning` flag or parse the Agent's reply for a title.

### 8.4 Shared Gaps to Close, Not New Ink Services

Five existing mechanisms require a small shared extension before either adapter can safely rely on the new contract:

1. **Persistence result:** current action-log flushing is unrelated to node persistence, and `drainPendingSaves()` reports settlement rather than success. The submission barrier must report failed/conflicted structure or content saves and verify the intended Canvas scope before sending. Use existing queues and conflict handling, not direct toolbar HTTP writes or a new autosave path.
2. **Durable acceptance:** the initial SSE `meta` precedes turn persistence. Expose a typed acceptance notification through the existing Agent SSE/transport/controller after the canonical turn-start boundary, reusing the existing turn-start readiness mechanism. It must carry canonical turn identity and be tested against preparation/persistence failure; do not infer acceptance from the first arbitrary event.
3. **Required visual input:** ordinary Chat snapshots and image inlining are currently best effort. In the same envelope/renderer, derive required Ink visuals from `inputKind` and the partial selection. If a required source cannot be snapshotted or inlined as an actual image part, reject preparation instead of executing a text fallback with the handwritten request missing. For built-in Agents, inspect the effective model's existing image capability metadata, including explicit per-thread model overrides. For external Agents, deliver the image block best effort because ACP currently has no authoritative vision-capability field; do not silently change Agents/models or imply guaranteed support. Preserve best-effort behavior for optional visuals on legacy text turns.
4. **Visible relationship grounding:** extend the existing Canvas DOM screenshot primitive with a bounded semantic-content capture mode that preserves current zoom/LOD while excluding UI chrome. Carry the result through the shared request/envelope/renderer as a hidden required image for mixed Ink/object turns. Do not overload user attachments, source snapshots, or transcript projection with this derived visual.
5. **Structured inferred intent:** add the built-in `report_ink_intent` tool and one typed folded projection shared by live and history rendering. The handler validates concise plain text, associates it with the active Ink turn, and conditionally renames only the pending auto-created Question through the server executor. Keep the tool row hidden and keep the interpretation out of user-authored content.

The shared Stop path participates in durable acceptance. `POST /api/agent/stop/:threadId` aborts the active invocation and returns its synchronously recorded turn-start state before the browser aborts its local stream. If the turn has started, the response carries the same acceptance identity; if it has not, Stop seals the state as unaccepted and both Agent runners check cancellation immediately before starting durable execution. The controller routes SSE and Stop acknowledgements through one deduplicating acceptance sink. This prevents a Stop racing with turn persistence from retaining an already-consumed Ink selection and making duplicate submission appear safe without making Stop wait on pre-turn preparation.

The input-kind branches belong at validation/rendering and honest message presentation boundaries. Loading, errors, retries, cancellation, replay, settings, and tool execution must not branch into separate Ink implementations. Characterize existing text Chat before extraction and add cross-entry tests for each shared extension.

## 9. State and Failure Model

```text
selection-ready -> capture operands + reserve local preparation
      -> resolve/create Question -> await successful saves
      -> shared request preparation and dispatch
           +-- known rejection -> retain target + selection for retry
           +-- transport ambiguity -> reconcile history/live stream
           +-- durable acceptance -> running + retire captured selection
                                        +-- answer/task -> done/error
                                        +-- ambiguity -> done + clarification
```

The new Question Node is retained if dispatch fails after creation. Automatic deletion would require unsafe compensation across Canvas persistence and Agent history boundaries and could remove a node the user has already seen or moved. Keep the created target in the local submission attempt: retrying that failed attempt or reactivating the unchanged candidate must reuse its node/thread, not classify the still-selected sources as another new task. Guard local preparation before minting IDs; the shared per-thread stream claim cannot prevent two nodes being created before a thread exists. This local guard is not a second stream coordinator.

The accepted boundary must be explicit and shared with text Chat. The current initial SSE `meta` is emitted before the invocation is consumed and before `handle.run()` persists the submission, so it is not a durable acceptance acknowledgement. V1 needs a shared, typed acknowledgement emitted only after the canonical turn-start persistence boundary; the client transport/controller must expose it to both callers. Neither a resolved `fetch` nor the current `meta` event authorizes selection clearing. This is an extension to the existing Agent SSE contract, not a separate Ink protocol.

At acknowledgement, retire the retained selection only if the originating Canvas and selection identity still match the captured attempt. A newer Lasso selection, undo/reset, or Canvas switch must not be cleared by a delayed callback. Once a turn has been accepted, a later Agent error does not restore an obsolete selection over the user's current work.

### 9.1 Retry Is Not Replay

The current Chat retry action calls `startStream(lastUserMsg.content, mode)`, losing the original source/attachment/Skill input and failing outright on an empty-text Ink message. Replace it in the shared path, not with an Ink-only retry button:

- **Reconnect/recovery:** observe the already-started turn through existing history/live-stream attachment. Durable rendered inputs remain unchanged; do not issue another POST or re-snapshot sources.
- **Explicit retry after a known rejection or terminal failure:** submit a new turn to the same owner with the original input kind, user text, attachment refs, source IDs/stroke IDs, explicit invoked skills, and the original hidden grounding visual/capture metadata. The grounding image records the original gesture's pointing evidence and is reused rather than silently recaptured from an unrelated current viewport; ordinary node/Ink materialization otherwise follows the existing fresh-read semantics. Do not borrow current selection or pending composer attachments. Resolve binding/mode and current target-thread settings through the normal path, and make the user create a new Lasso submission when they intend a new visual relationship.
- **Unknown acceptance after connection loss:** keep the target and reconcile using the existing thread history/stream before offering resubmission. Neither the local claim nor server lease provides idempotency. Do not silently auto-POST after reconnect; if reconciliation cannot resolve the outcome, report it and require an explicit user decision before risking another turn.

Persist the input kind and sufficient source metadata through the common transcript/history projection so retry works after reload as well as for an optimistic row. A pre-acceptance attempt and retained Lasso selection remain transient; reloading is not a guarantee that an unsent draft survives. The retained Question is the recovery entry, not a second durable Ink task queue.

## 10. Implementation Plan and Commit Sequence

The feature should ship as one PR built from reviewable commits. Tests belong with the behavior they introduce; the sequence below is not a request to defer all tests to the end.

### Commit 1 — `docs: propose ink lasso question flow`

- Add this proposal and link it from [`docs/README.md`](../README.md).
- Record the differences from the earlier HTML concept without requiring the concept file as part of this proposal.
- Record approved scope, protocol, failure behavior, and acceptance criteria before product code changes.

### Commit 2 — `feat(agent): add durable ink intent submissions`

- Add the zod-first `ink-intent` marker to the existing Agent request contract without adding a parallel revision protocol.
- Validate Ink requirements and effective thread ownership/binding at the server boundary; preserve internal `ask` and external ACP bindings on existing targets.
- Carry the normalized kind through `ChatEnvelope`, durable request records, replay, and transcript projection.
- Render the host-owned infer/execute/clarify directive and reuse existing envelope refs, partial-stroke snapshot attachments, canonical `rendered` inputs, and read-set CAS.
- Extend the shared preparation path to enforce required Ink image parts, validate effective built-in model vision support, and preserve those image parts through ACP lowering without changing optional text-Chat attachment behavior.
- Add durable acceptance to the existing typed SSE contract at the actual turn-start persistence boundary, including canonical turn identity.
- Add shared/server tests for legacy text compatibility, Ink rendering, a fully stale stroke subset, replay stability, live material reads, CAS conflicts, and transcript source metadata.

### Commit 3 — `refactor(web): share question turn submission`

- Characterize current text Chat, then extract its component-independent Agent-turn controller while preserving node-less, anchored, and headless conversation behavior.
- Keep `useAgentStream` as the Chat adapter; retain existing source serialization, stream claims, event reduction, history attachment, settings, and lifecycle owners.
- Expose explicit captured sources, a success-reporting barrier over existing save queues, and the shared durable-acceptance callback.
- Replace text-only retry with a common typed-input retry path for both inputs. Keep reconnect distinct from a new submission.
- Add focused tests for first turn, follow-up, anchor exclusion, lifecycle transitions, cross-entry duplicate-send guards, error handling, and stopping a background-started turn from Chat.

### Commit 4 — `feat(canvas): submit lassoed ink as a question`

- Extend `StrokeSelectionToolbar` with source count, the adjacent Agent target hint, blocked states, and submit.
- Capture selected node/stroke IDs and classify zero/one/multiple Question targets through existing conversation ownership rules.
- Resolve Question targets only from the Lasso-selected node IDs, using visible takeover-mark geometry for collapsed Agent Nodes; never route from the active Chat/Preview tab.
- Create and persist a new built-in Question Node below the selection or continue one eligible existing internal/external thread without rebinding it.
- Keep Chat closed, clear selection only after acceptance, and retain the node/selection on failure.
- Keep the created target across local retries, guard creation before thread assignment, and prevent late acceptance from clearing a newer selection.
- Add component/store tests for pure and mixed selections, pointer isolation, accessibility, and all routing guards.

### Commit 5 — `test: cover ink lasso question workflow`

- Add the narrowest practical integration or Playwright coverage for new-task execution, internal/external existing-thread continuation, fully stale Ink rejection, ambiguous clarification visibility, and failure retry.
- Verify desktop and touch toolbar layouts without changing Lasso gesture ownership.
- Keep Voice, OCR, general/heuristic automatic naming, ACP vision-capability claims, and multi-target synthesis explicitly absent; the guarded structured placeholder replacement arrives only in Commit 6.

### Commit 6 — `feat(agent): ground and present inferred ink intent`

- Add the visible-Canvas grounding contract before declaring the proposal shipped: capture the mixed Ink/object relationship at current zoom/LOD, carry it as hidden canonical Agent input, and keep it absent from ChatPanel/source projections.
- Add a same-turn built-in `report_ink_intent` primitive with `inferred | clarify | unsupported` results; validate and persist it without parsing assistant prose or making another model call.
- Project a valid inferred intent as the primary Ink-row text while retaining Pen provenance and preserving empty user `content`; keep the generic fallback for missing, malformed, ambiguous, unsupported, failed, and external-Agent turns.
- Conditionally rename only the untouched auto-created Question placeholder, set Agent label provenance, and never rename an existing target or a user-renamed node.
- Add request/envelope/renderer tests, browser capture tests across zoom LODs, and integration coverage proving that object-internal pointing survives submission and replay.
- Add live/history parity, retry/reconnect, malformed-report, user-rename race, existing-target protection, external fallback, and conversation-search tests for inferred intent.

### Commit 7 — `docs: document shipped ink question flow`

- After product behavior is accepted, fold the durable contracts into [`sketch-node.md`](../architecture/sketch-node.md), [`question-node.md`](../architecture/question-node.md), [`agent-context.md`](../architecture/agent-context.md), [`agent-architecture.md`](../architecture/agent-architecture.md), [`preview-workspace.md`](../architecture/preview-workspace.md), and [`canvas-input-interactions.md`](../architecture/canvas-input-interactions.md) as applicable. Document shared acceptance, persistence, retry, and controller lifetime where their owning subsystem is described.
- Set this proposal to `Status: Shipped`, record the PR/commit, update `Last updated`, and leave the proposal at this stable path.

If implementation shows that Commit 2 and Commit 3 cannot be reviewed independently because the request shape and controller must change atomically, combine them rather than leaving an intermediate commit that does not build or pass tests. Do not combine unrelated cleanup into this PR.

## 11. Validation Strategy

### 11.1 Shared and server contract tests

- Legacy text submissions still reject empty text and render exactly as before.
- `ink-intent` accepts empty text only with at least one non-empty partial Sketch selection.
- Whole-Sketch selection without `strokeIds` does not satisfy the V1 intent gate.
- The rendered input contains the host directive, revisioned selected-node metadata, and the materialized partial-stroke image.
- A KEEP-list with no surviving selected strokes never renders the whole Sketch, and the required-input failure propagates through envelope preparation rather than being swallowed.
- Required Ink image snapshot/inlining failures and non-vision effective models reject before execution; optional text-Chat visuals retain their existing fallback behavior.
- Mixed Ink/object requests reject before execution when the visible-Canvas grounding image is missing, invalid, or cannot be inlined; pure Ink retains its existing partial-stroke visual requirement without inventing an object relationship image.
- The grounding renderer preserves the submitted bitmap and metadata byte-for-byte through durable replay and never re-renders hidden text at a different zoom/LOD.
- Durable acceptance is emitted only after turn-start persistence, never for preparation/persistence failure; initial `meta` does not trigger acceptance.
- Stop racing with turn-start returns and applies the same durable acceptance exactly once before local stream cancellation.
- An ordinary selected material edited before the Agent's first full read is read at its latest revision.
- A material edited after the Agent reads it produces the existing `stale` CAS conflict on content write; an unread material produces `not-read`.
- Durable replay uses stored rendered inputs and does not snapshot the current Canvas again.
- Multiple Question targets and invalid threads are rejected. Existing internal `ask` targets retain read-only semantics; existing external targets retain ACP semantics; new targets use built-in `operate`.

### 11.2 Web unit and component tests

- Pure Ink shows style controls plus source count and submit.
- Mixed Ink/node selection shows source count and submit on desktop and touch; style controls stay hidden for mixed selection.
- The Agent target hint sits beside the source count: no selected Agent Node shows `New · Huabu`, one valid target shows its effective bound Agent display name, and the hint does not change the source count.
- Internal and external Agent names use the existing binding/Profile display-name projection rather than the Question title. Long names remain layout-stable and expose their full value through tooltip and accessible text.
- No Ink hides or disables Ink submission.
- One eligible Question Node routes to its thread and is excluded from source count/context.
- A collapsed Agent mark enclosed by the Lasso routes to its Question thread even when the hidden card footprint is outside the polygon; an open but unlassoed Chat never becomes the target.
- Multiple Question Nodes and invalid Question targets expose a clear disabled reason. A valid external Question remains enabled.
- A rapid double activation creates at most one Question and starts at most one turn; Chat and Lasso cannot independently dispatch to the same busy thread.
- Acceptance clears only the originating selection; validation rejection or ambiguous transport failure retains it without erasing later user input.
- Toolbar interactions do not move strokes, start Lasso, or trigger Canvas placement.
- The send button has an accessible name, keyboard activation, visible focus, and a stable disabled state.
- Grounding capture at multiple zoom thresholds contains exactly the semantic Canvas content visible at each threshold: zoomed-out captures do not reveal hidden body text, while zoomed-in captures preserve the visible paragraph/list-item layout and Ink landing position.
- ChatPanel, optimistic messages, history hydration, source count, source chips, hover highlighting, and attachment lists never expose the hidden grounding image or count it as a source.
- A valid built-in inferred-intent report replaces the generic Ink-row text without changing its empty user `content`; malformed, missing, clarify, unsupported, error, and external-Agent paths retain the fallback.
- Auto-naming updates only an untouched pending `New ink request` node, writes Agent label provenance, and loses deterministically to a concurrent user rename. Existing Question targets never change title.

### 11.3 Shared Pipeline Regression Tests

Start from existing `agentStreamCoordinator.test.ts`, `chatSessionIsolation.test.tsx`, `questionCompose.test.ts`, and Chat input/history tests; add focused controller tests rather than a parallel Ink test harness.

- Text and Ink use the same request preparation, claim, event reducer, terminal handling, stop, and history attachment paths. Text rejects empty input as before; all existing external Chat event handling survives extraction.
- An Ink send does not consume drafts, uploads, the selected-text excerpt, or Skills from any Chat composer. Its source metadata remains consistent after asynchronous validation even if active selection changes.
- Target-thread settings and persisted owner binding/mode win over an unrelated active tab. Node-less Chat and World/headless scope behavior remain unchanged.
- The save barrier waits for structure and sidecar writes, blocks on failure/conflict, and is not satisfied by action-log flushing. Navigation drain behavior remains unchanged.
- Create-only Question initialization neither opens Preview nor writes a placeholder into user content; later text follow-ups do not reinitialize the thread or trigger Ink title inference.
- Retry preserves typed input, sources, attachments, and explicit skills for both text and Ink, including after history hydration. Reconnect does not POST another turn.
- A stream started while Chat is closed updates common thread state; opening Chat does not double-attach, and Stop cancels that same server turn. Closing the tab does not stop it.
- Shared unread/terminal/change-review behavior survives, including the existing guard against a late error overriding an already-observed successful completion.

### 11.4 Integration checks

- New-task path creates one Question Node below the selection, keeps Chat closed, enters `running`, and later exposes the conversation from the Agent mark.
- Existing-task path appends one turn to the selected internal or external Question thread without creating a node or changing its binding.
- A failed first submission retries against the already-created Question rather than creating another one; uncertain acceptance reconciles before resubmission.
- A clear Ink request can execute existing Canvas tools under normal approval policy.
- In a mixed Ink/object example, an arrow or underline aimed at a visible internal object element is delivered as one relationship image with the same current LOD, allowing the Agent to distinguish element-level elaboration from whole-node resize/rewrite intent.
- The same example displays a concise structured interpretation such as `Expand the third comparison step in the left note` in its Ink history row and, for a newly created untouched Question only, as the Question label.
- An ambiguous Ink request produces a focused clarification and no guessed Canvas mutation.
- Restart/reload preserves the Ink request row, source chips, selected stroke IDs, thread ownership, and terminal status.
- Undo/redo or authoritative Canvas replacement clears stale transient selection through the existing preview reset contract.

Before PR handoff, run the repository-required `pnpm typecheck`, `pnpm format`, and `pnpm lint:fix`, review formatter/linter changes, and rerun affected focused tests.

## 12. Acceptance Criteria

V1 is complete when all of the following are true:

1. A user can Lasso one or more Sketch strokes, optionally include ordinary Canvas nodes, and explicitly submit from the existing floating toolbar.
2. A submission with no Question target creates exactly one persisted built-in Question Node near the selection and starts one `operate` turn without opening Chat.
3. A submission with one eligible Question target continues exactly that thread and creates no new node.
4. Multiple or invalid Question targets cannot be submitted and explain why; one valid external Question target keeps its selected Agent.
5. The Agent receives the materialized partial-stroke visual and the existing revisioned refs for other selected sources, infers a clear intent and executes it, or asks for clarification without guessing.
6. The request, rendered input, selected stroke IDs, source metadata, and Question lifecycle survive reload and replay.
7. Visual replay remains point-in-time, ordinary material reads remain fresh, fully stale Ink is never widened to a whole Sketch, and Agent content writes retain existing read-before-write/CAS protection.
8. Existing text Chat, Lasso editing, stroke movement, deletion, undo, pointer routing, and Question interactions do not regress.
9. Voice, OCR, intent confirmation, ACP capability negotiation, general/heuristic automatic naming, and multi-target synthesis are absent from the shipped UI and protocol behavior; the only naming exception is Commit 6's structured replacement of an untouched Ink placeholder.
10. Chat and Ink share one dispatch/retry/stream/recovery implementation, with thread-scoped settings and no dependency on an open Chat. Optimizing the common pipeline does not require a second Ink change.
11. A rejected submission cannot execute without its required Ink visual; a delayed acknowledgement cannot clear a newer selection; retry of a failed new task reuses its existing Question.
12. The toolbar gives immediate target feedback beside the source count: `New · Huabu` when no Agent Node is included, the effective Agent name when exactly one valid Agent Node is included, and a blocked indication for multiple or invalid targets.
13. Every mixed Ink/object submission gives the Agent a hidden visible-Canvas grounding image that preserves submission-time zoom/LOD and Ink/object placement, survives replay, and remains absent from ChatPanel and all user-visible source/attachment projections.
14. A valid same-turn built-in inferred intent replaces generic Ink placeholders without changing user-authored content; it survives replay, never renames existing or user-renamed Questions, and safely falls back when no trustworthy structured report exists.

## 13. Deferred Follow-Ups

Each follow-up requires its own proposal or an explicit lifecycle update to this one:

- Voice as an additional intent source, including recording, transcription, and privacy/error states.
- A two-stage `infer -> confirm/execute` flow with a structured `ready | clarify | unsupported` result.
- Full inferred-intent parity for external ACP Agents, gated on an authoritative structured capability rather than session-title or reply-text heuristics.
- ACP vision capability declaration and capability-gated Ink affordances.
- Image-faithful fallback replay when an external Agent cannot resume its native ACP session.
- Multiple Question Nodes as a new synthesized task with explicit thread-reference semantics.
- Handwritten sigils for capability, resource, Agent, or Skill selection.

## 14. Code Entry Points

| Concern                                   | File                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stroke selection state                    | [`apps/web/src/store/gesturePreviewStore.ts`](../../apps/web/src/store/gesturePreviewStore.ts)                                                                                 |
| Stroke selection toolbar                  | [`apps/web/src/components/Panels/Canvas/FloatingToolbars/StrokeSelectionToolbar.tsx`](../../apps/web/src/components/Panels/Canvas/FloatingToolbars/StrokeSelectionToolbar.tsx) |
| Lasso and pointer routing                 | [`apps/web/src/components/Panels/Canvas/Canvas.tsx`](../../apps/web/src/components/Panels/Canvas/Canvas.tsx)                                                                   |
| Partial-stroke hit testing                | [`apps/web/src/components/Nodes/sketch/sketchHitTest.ts`](../../apps/web/src/components/Nodes/sketch/sketchHitTest.ts)                                                         |
| Question creation/entry                   | [`apps/web/src/components/Nodes/question/questionCompose.ts`](../../apps/web/src/components/Nodes/question/questionCompose.ts)                                                 |
| Current turn orchestration                | [`apps/web/src/hooks/useAgentStream.ts`](../../apps/web/src/hooks/useAgentStream.ts)                                                                                           |
| Chat submit and retry adapter             | [`apps/web/src/components/Panels/ChatPanel/index.tsx`](../../apps/web/src/components/Panels/ChatPanel/index.tsx)                                                               |
| Ink-row inferred-intent presentation      | [`apps/web/src/components/Messages/UserMessage.tsx`](../../apps/web/src/components/Messages/UserMessage.tsx)                                                                   |
| Stream ownership and deduplication        | [`apps/web/src/hooks/agentStreamCoordinator.ts`](../../apps/web/src/hooks/agentStreamCoordinator.ts)                                                                           |
| Conversation owner and lifecycle routing  | [`apps/web/src/store/conversationOwner.ts`](../../apps/web/src/store/conversationOwner.ts)                                                                                     |
| Shared source serializer and save queues  | [`apps/web/src/store/canvasStore.ts`](../../apps/web/src/store/canvasStore.ts)                                                                                                 |
| Visible Canvas grounding capture          | [`apps/web/src/handler/canvasCommand/utils/screenshot.ts`](../../apps/web/src/handler/canvasCommand/utils/screenshot.ts)                                                       |
| Thread history and live attachment        | [`apps/web/src/hooks/useChatHistory.ts`](../../apps/web/src/hooks/useChatHistory.ts)                                                                                           |
| Thread-scoped UI state and settings       | [`apps/web/src/store/chatStore.ts`](../../apps/web/src/store/chatStore.ts)                                                                                                     |
| Agent transport and SSE decoding          | [`apps/web/src/api/agent.ts`](../../apps/web/src/api/agent.ts)                                                                                                                 |
| Shared Agent request schema               | [`packages/shared/src/types/api/agent.ts`](../../packages/shared/src/types/api/agent.ts)                                                                                       |
| Envelope and auto-snapshot                | [`apps/server/src/modules/agent/conversation/envelope.ts`](../../apps/server/src/modules/agent/conversation/envelope.ts)                                                       |
| Canonical turn renderer                   | [`apps/server/src/modules/agent/conversation/prompt/build-prompt.ts`](../../apps/server/src/modules/agent/conversation/prompt/build-prompt.ts)                                 |
| Inferred-intent tool contract             | [`apps/server/src/modules/agent/tools/definitions.ts`](../../apps/server/src/modules/agent/tools/definitions.ts)                                                               |
| Agent route                               | [`apps/server/src/modules/agent/agent.route.ts`](../../apps/server/src/modules/agent/agent.route.ts)                                                                           |
| Shared server lease and dispatch          | [`apps/server/src/modules/agent/agent-thread.service.ts`](../../apps/server/src/modules/agent/agent-thread.service.ts)                                                         |
| Canonical rendering and turn-start signal | [`apps/server/src/modules/agent/agent.service.ts`](../../apps/server/src/modules/agent/agent.service.ts)                                                                       |
| History source/input projection           | [`apps/server/src/modules/agent/conversation/transcript/history.ts`](../../apps/server/src/modules/agent/conversation/transcript/history.ts)                                   |
| Image inlining and fallback policy        | [`apps/server/src/modules/agent/conversation/prompt/image-inlining.ts`](../../apps/server/src/modules/agent/conversation/prompt/image-inlining.ts)                             |
| Partial snapshot implementation           | [`apps/server/src/modules/canvas/snapshot-nodes.ts`](../../apps/server/src/modules/canvas/snapshot-nodes.ts)                                                                   |
