# Interrupted reasoning recovery

Elenx replays completed encrypted reasoning during bounded in-call recovery through Pi's existing message serializer. Pi 0.85.0 supplies the completion events and signed content, but its agent and harness recovery paths exclude failed assistant messages from the next model input. Elenx adds an input-only projection in `src/pi-recovery.ts` and keeps Pi's original failed message in the transcript. The [runner contract](../SPEC.md#pi-runner) defines admission, retry limits, and durability.

## Pi integration

Pi's `openai-responses-shared` parser emits `thinking_end` and sets `thinkingSignature` after `response.output_item.done`. Its serializer parses that signature back into the original Responses item. Its `transform-messages` pass omits errored and aborted assistant messages, including their completed reasoning. Pi's higher-level harness also excludes these messages from generation context, so switching agent APIs alone would lose the completed items.

Elenx observes these public events, snapshots validated encrypted reasoning, and projects only those blocks into later model input. Pi continues to own parsing, serialization, error classification, and tool execution. Elenx retains its existing bounded retry loop and adds the exact incomplete-stream message whose error code the Codex adapter can omit.

## Verification on 2026-09-05

The live smoke ran Elenx on Saturn with each actual HTTPS request made from DMIT to `https://chatgpt.com/backend-api/codex/responses`, using the same selected OAuth credential throughout. It bypassed codex-lb, forced SSE, and disabled Pi adapter retries. A test relay deliberately ended the first response immediately after forwarding a completed reasoning item, before a terminal response event.

- Model: `gpt-5.6-sol`, reasoning `max`, Pi 0.85.0.
- First request HTTP 200 at `20:10:26.524Z`. Recovery request HTTP 200 at `20:10:41.665Z`. Final success at `20:11:46.427Z`.
- Completed and replayed item: `rs_049ba53582c4b2f0016a9c7733219887d2ba8284caf4d8edc4`.
- Encrypted content: 3,556 bytes. Original and retry SHA-256: `bef8b60bd8f6fa7a93d5654be6ce8cd9619a7dc05d9a8c6d4a41b43ae9ad05a1`.
- Two provider requests, one recorded request error, one successful terminal tool execution. Failed-request usage remained unmeasured.
- Local untracked artifacts: `runs/reasoning-recovery-20260905/campaign-3.db`, `result.json`, and `smoke.ts`. Credentials were passed in memory and SSH stdin, outside campaign payloads. Relay processes exited after the test.

This smoke proves the recovery payload is accepted by the tested Codex endpoint. It is a controlled interruption test, not a new measurement of the fifteen-minute failure rate or proof that every Responses-compatible endpoint accepts reasoning-only replay. Pi's regression suite includes an orphaned-reasoning rejection case for another request shape, so compatibility with other endpoints must be checked.

`tests/v1/pi-recovery.test.ts` exercises both installed Responses adapters with synthetic SSE and captures their actual outbound payloads, including Codex zstd request bodies. It checks byte-exact replay, repeated interruptions, duplicate IDs, prior tool results, failed-tool exclusion, malformed signatures, model identity, cancellation, and isolation between calls. Run it with `bun test ./tests/v1/pi-recovery.test.ts --path-ignore-patterns='runs/**'` under the locked Bun runtime.
