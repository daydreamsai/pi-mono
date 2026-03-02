import { describe, expect, test, vi } from "vitest";
import { PermitCache } from "../../examples/extensions/custom-provider-x402/src/cache.js";
import { buildX402StreamOptions } from "../../examples/extensions/custom-provider-x402/src/stream-options.js";
import type { RouterConfig } from "../../examples/extensions/custom-provider-x402/src/types.js";

const VALID_PRIVATE_KEY = `0x${"1".repeat(64)}`;

const ROUTER_CONFIG: RouterConfig = {
	network: "eip155:8453",
	asset: "0xAsset",
	payTo: "0xPayTo",
	facilitatorSigner: "0xPayTo",
	tokenName: "USD Coin",
	tokenVersion: "2",
	paymentHeader: "PAYMENT-SIGNATURE",
};

describe("x402 stream options", () => {
	test("wraps fetch with x402 payment injection for dynamic signing", async () => {
		const seenHeaders: string[] = [];
		const baseFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			seenHeaders.push(headers.get("PAYMENT-SIGNATURE") ?? "");
			return new Response("{}", { status: 200 });
		});

		const next = buildX402StreamOptions(
			{
				apiKey: "test",
				fetch: baseFetch,
			},
			{
				routerUrl: "http://localhost:8080",
				permitCap: "10000000",
				privateKey: VALID_PRIVATE_KEY,
				permitCache: new PermitCache(() => 0),
				resolveRouterConfig: async () => ROUTER_CONFIG,
				signer: async () => ({
					paymentSig: "sig-1",
					deadline: 99999,
					maxValue: "10000000",
					nonce: "1",
					network: ROUTER_CONFIG.network,
					asset: ROUTER_CONFIG.asset,
					payTo: ROUTER_CONFIG.payTo,
				}),
			},
		);

		expect(next.fetch).not.toBe(baseFetch);
		await next.fetch?.("http://localhost:8080/v1/chat/completions", {
			method: "POST",
			body: "{}",
		});
		expect(seenHeaders).toEqual(["sig-1"]);
	});

	test("uses static signature fallback without fetch wrapping", () => {
		const baseFetch = vi.fn(async () => new Response("{}", { status: 200 }));
		const next = buildX402StreamOptions(
			{
				apiKey: "test",
				fetch: baseFetch,
			},
			{
				routerUrl: "http://localhost:8080",
				permitCap: "10000000",
				staticPaymentSignature: "static-sig",
				paymentHeader: "PAYMENT-SIGNATURE",
			},
		);

		expect(next.fetch).toBe(baseFetch);
		expect(next.headers?.["PAYMENT-SIGNATURE"]).toBe("static-sig");
	});
});
