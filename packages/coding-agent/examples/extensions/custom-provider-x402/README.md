# x402 Provider Extension (Phase 2)

This extension registers an `x402` provider in Pi with:

- Env-only configuration
- Static model registration
- Single-wallet assumptions
- Live fetch wiring for payment injection in streaming requests
- Router config resolver with 5-minute TTL cache
- viem-based signer that builds x402 `PaymentPayload` headers

## Usage

```bash
X402_PRIVATE_KEY=0x... \
X402_ROUTER_URL=http://localhost:8080 \
pi -e ./packages/coding-agent/examples/extensions/custom-provider-x402
```

## Environment Variables

- `X402_PRIVATE_KEY` (required): wallet private key format validation
- `X402_ROUTER_URL` (optional): defaults to `http://localhost:8080`
- `X402_NETWORK` (optional): defaults to `eip155:8453`
- `X402_PERMIT_CAP` (optional): defaults to `10000000` (base units)
- `X402_PAYMENT_HEADER` (optional): defaults to `PAYMENT-SIGNATURE`
- `X402_MODEL_ID` (optional): defaults to `kimi-k2.5`
- `X402_MODEL_NAME` (optional): defaults to `Kimi K2.5`
- `X402_PAYMENT_SIGNATURE` (optional): static payment signature header value

## Status

Phase 2 integration is active for streamed inference calls:

- Payment signatures are injected through a wrapped fetch path
- Invalid/stale permit responses trigger a bounded one-time retry
- `/v1/config` and `/v1/models` bypass payment injection
- `X402_PAYMENT_SIGNATURE` static fallback remains supported

Remaining follow-up hardening:

- Expanded multi-chain RPC coverage beyond default mappings
- Expanded error taxonomy/telemetry
