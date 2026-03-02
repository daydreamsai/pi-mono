# x402 Payment Integration (Phase 2)

## PRD + TDD

## 1. Summary
Finish the x402 extension integration so payment permit logic is active in real streaming requests, not just helper modules.

## 2. Confirmed Decisions
1. Signing/runtime crypto library: `viem`
2. Router config cache TTL: `5 minutes`
3. Unknown/complex pieces in this phase: `stub for now`

## 3. Problem Statement
Current x402 extension wiring has:
- provider/model registration
- env parsing and validation
- tested helpers for permit cache, payment-required parsing, retry orchestration

But it does **not** fully wire payment injection + retry into the live stream request path.

## 4. Goals
1. Inject payment signature headers for inference calls.
2. Retry once on stale/invalid permit (401/402) using `PAYMENT-REQUIRED` hints.
3. Keep streaming behavior and existing provider UX unchanged.
4. Preserve static signature fallback via `X402_PAYMENT_SIGNATURE`.

## 5. Non-Goals
1. Multi-wallet orchestration.
2. Full production-grade signer and chain abstraction.
3. New TUI/UI features for payment diagnostics.

## 6. Scope
### In Scope
- Add fetch-hook capability required for x402 interception in stream path.
- Wire `createX402Fetch(...)` into x402 stream implementation.
- Add router config resolver with TTL cache (5 min).
- Add `viem`-based signer integration point (stub-friendly for now).
- Add/extend tests for end-to-end payment flow behavior.

### Out of Scope (Stubbed for This Phase)
- Final canonical permit payload schema hardening.
- Production-grade failure taxonomy beyond current invalidation rules.
- Advanced background refresh / proactive permit renewal.

## 7. Functional Requirements
1. Inference requests on router origin include payment header.
2. `/config` and `/models` paths skip payment header injection.
3. Permit cache key includes network, asset, payTo, and maxValue.
4. Cache entries expire with deadline skew handling.
5. On invalid permit 401/402, invalidate and retry once.
6. `PAYMENT-REQUIRED` overrides are applied to retry config/cap.
7. Non-permit errors do not trigger retry loop.
8. Abort signal propagates through fetch + stream path.

## 8. Non-Functional Requirements
1. No breaking behavior for non-x402 providers.
2. Keep type safety (no unnecessary `any`).
3. Bounded retry behavior (max one retry).
4. Clear error messages for signer/config failures.

## 9. Implementation Plan
1. `packages/ai`:
   - Add optional custom `fetch` pass-through in stream options path used by OpenAI completions provider.
   - Ensure existing providers remain unaffected.
2. `custom-provider-x402` extension:
   - Wire runtime fetch wrapper into stream call.
   - Add router-config resolver with 5-minute TTL cache.
   - Add signer integration interface backed by `viem`.
   - Keep signer/config complex internals stubbed where needed.
3. Tests:
   - Add tests for live stream wiring and retry behavior.
   - Keep existing deterministic x402 helper tests.
4. Docs:
   - Update extension README status from groundwork to integrated (with stubs called out).

## 10. TDD Plan (Red-Green-Refactor)

### Cycle 1
- Red: test that custom fetch hook is invoked by openai-completions path.
- Green: implement minimal fetch option plumbing.
- Refactor: unify option shaping.

### Cycle 2
- Red: test x402 stream injects payment header for inference endpoint.
- Green: wire `createX402Fetch(...)` into stream path.
- Refactor: extract x402 stream option builder.

### Cycle 3
- Red: test stale permit 402 invalidates + retries once with updated cap.
- Green: integrate retry logic in live path.
- Refactor: reduce duplicate cache invalidation logic.

### Cycle 4
- Red: test non-permit 402 does not retry.
- Green: gate retry by invalid-permit predicate.
- Refactor: centralize error classification.

### Cycle 5
- Red: tests for config/models bypass, static signature fallback, abort propagation.
- Green: complete edge-case handling.
- Refactor: simplify wrapper helpers and fixtures.

## 11. Test Matrix
1. Payment header injected for `/v1/chat/completions`.
2. Payment header not injected for `/v1/config` and `/v1/models`.
3. Cached permit reused while valid.
4. Expired permit triggers re-sign.
5. Invalid permit response triggers one retry.
6. Retry uses required cap from `PAYMENT-REQUIRED` when provided.
7. Unrelated 401/402 does not retry.
8. Static signature mode works without signer.
9. Abort signal cancels execution correctly.

## 12. Delivery Milestones
1. M1: Fetch hook support merged.
2. M2: x402 stream wiring + TTL resolver merged.
3. M3: Retry behavior + tests merged.
4. M4: README/docs update merged.

## 13. Risks and Mitigations
1. Risk: SDK transport edge cases with custom fetch.
   - Mitigation: targeted provider tests and fallback behavior.
2. Risk: signer payload mismatch with router expectations.
   - Mitigation: stub signer boundaries now; isolate final payload mapping for later hardening.
3. Risk: hidden regressions in OpenAI-compatible providers.
   - Mitigation: keep changes minimal and additive; run full check.

## 14. Acceptance Criteria
1. New tests are written first and observed failing before implementation.
2. x402 payment injection + one-retry flow works in integrated stream path.
3. TTL cache for router config is 5 minutes.
4. `viem` is the selected signer stack (with stubs where needed).
5. `npm run check` passes after code changes.

## 15. Stubbed Items (Explicit)
1. Final permit payload hardening and chain-specific edge handling.
2. Extended error taxonomy and telemetry enrichment.
3. Advanced config refresh strategies beyond fixed TTL.
