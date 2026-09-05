# Pi 0.85 upgrade

Elenx pins Pi AI, agent core, and coding agent to `0.85.0`, the npm latest release checked on 2026-09-04. The previous pin was `0.84.2`. The upstream release commit is `107d79f11072bbc8a3a757ed7fd69596bee7d68c` ([release](https://github.com/earendil-works/pi/releases/tag/v0.85.0), [AI changelog](https://github.com/earendil-works/pi/blob/v0.85.0/packages/ai/CHANGELOG.md), [agent changelog](https://github.com/earendil-works/pi/blob/v0.85.0/packages/agent/CHANGELOG.md)).

## Integration and simplification

Pi's `startAiSpan` helper now takes a Chord context. Elenx uses `createTypedSpanStarter` with `AI_TELEMETRY_SCHEMA`, the same API already used for its logical-call span. This preserves the request span schema and parentage with Elenx's existing telemetry context.

The published `pi-coding-agent@0.85.0` imports `pi-server` through its package entry point without declaring it as a dependency. The solver declares `pi-server@0.85.0` explicitly so installed consumers can load `ModelRuntime`. Remove this extra declaration when a later Pi release fixes its dependency manifest.

Pi's new simple-stream `toolChoice` accepts only `auto` and `none`. Elenx still requires `required` plus `parallel_tool_calls: false` for its terminal submission tools, so the payload wrapper remains. Real-adapter tests cover both Responses transports and verify these controls before the checkpoint hook, including requests with absent or empty tool declarations.

The release also fixes Codex SSE terminal events without a trailing blank line, provider reasoning replay, and proxy matching. These fixes arrive through the dependency upgrade. The codex-lb retry classification, stable transport session, prompt-cache key, and Responses instruction normalization still serve distinct contracts in Elenx. Pi's new assistant-message frames would require a journal representation change and do not simplify the current settled-transcript storage.

## GPT-6 Astra

Pi `0.85.0` can send `gpt-6-astra` requests through an explicit model definition. Its published built-in catalog contains no Astra entry. Elenx's solver therefore needs Astra registered in the model file selected by `ELENX_MODELS_PATH` before a role can select it. Provider credentials and accurate price metadata remain deployment configuration.

[OpenAI's model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra), retrieved on 2026-09-04, lists Responses and Chat Completions support, function calling, a 1,050,000-token context window, 128,000 maximum output tokens, and reasoning efforts `low`, `medium`, `high`, `xhigh`, and `max`. An explicit Pi model should carry that reasoning-level map. Elenx's current reasoning schema already accepts these values.

A live probe on Saturn used the OpenAI Responses adapter through `https://codex-lb.lab/v1`, reasoning `low`, a 1,024-token output cap, and Elenx's required terminal tool. Astra returned `{"answer":"4"}` and the call succeeded with one provider request. The usage tag is `elenx/pi-085-astra-20260904/attempt-2`. The untracked evidence is under `runs/pi-085-astra-20260904/`, including `campaign-2.db` and `result-2.json`. The first attempt failed at TLS because the locked runner clears inherited Node environment variables. The successful attempt explicitly supplied the existing lab CA to the child process.

The probe used zero price placeholders and establishes no pricing estimate. Tests exercise `max` request construction for both Responses adapters without contacting a provider. Live Codex OAuth transport, long-context behavior, and `max` reasoning quality were not tested.
