import { describe, expect, test, vi } from "vitest";
import { createRouterConfigResolver } from "../../examples/extensions/custom-provider-x402/src/router-config-resolver.js";

describe("x402 router config resolver", () => {
	test("caches /v1/config responses for 5 minutes by default", async () => {
		let now = 0;
		let call = 0;
		const baseFetch = vi.fn(async () => {
			call += 1;
			return new Response(
				JSON.stringify({
					networks: [
						{
							network_id: "eip155:8453",
							active: true,
							asset: { address: "0xAsset" },
							pay_to: call === 1 ? "0xPayTo-1" : "0xPayTo-2",
						},
					],
					eip712_config: {
						domain_name: "USD Coin",
						domain_version: "2",
					},
					payment_header: "PAYMENT-SIGNATURE",
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});

		const resolveRouterConfig = createRouterConfigResolver({
			routerUrl: "http://localhost:8080",
			baseFetch,
			now: () => now,
		});

		const first = await resolveRouterConfig();
		now = 299_999;
		const second = await resolveRouterConfig();
		now = 300_001;
		const third = await resolveRouterConfig();

		expect(first.payTo).toBe("0xPayTo-1");
		expect(second.payTo).toBe("0xPayTo-1");
		expect(third.payTo).toBe("0xPayTo-2");
		expect(baseFetch).toHaveBeenCalledTimes(2);
	});

	test("throws a clear error when /v1/config fails", async () => {
		const resolveRouterConfig = createRouterConfigResolver({
			routerUrl: "http://localhost:8080",
			baseFetch: vi.fn(async () => new Response("oops", { status: 500, statusText: "Internal Server Error" })),
		});

		await expect(resolveRouterConfig()).rejects.toThrow(
			"Failed to fetch x402 router config: 500 Internal Server Error",
		);
	});
});
