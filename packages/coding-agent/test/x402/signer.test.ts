import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";
import { createViemSigner } from "../../examples/extensions/custom-provider-x402/src/signer.js";
import type { RouterConfig } from "../../examples/extensions/custom-provider-x402/src/types.js";

const VALID_PRIVATE_KEY = `0x${"1".repeat(64)}`;

const ROUTER_CONFIG: RouterConfig = {
	network: "eip155:8453",
	asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	payTo: "0x1363C7Ff51CcCE10258A7F7bddd63bAaB6aAf678",
	facilitatorSigner: "0x1363C7Ff51CcCE10258A7F7bddd63bAaB6aAf678",
	tokenName: "USD Coin",
	tokenVersion: "2",
	paymentHeader: "PAYMENT-SIGNATURE",
};

describe("x402 viem signer", () => {
	test("builds a base64 payment payload envelope for PAYMENT-SIGNATURE", async () => {
		const signer = createViemSigner({
			now: () => 1_700_000_000_000,
			ttlSeconds: 300,
			resolveNonce: async () => "7",
		});

		const permit = await signer({
			privateKey: VALID_PRIVATE_KEY,
			routerConfig: ROUTER_CONFIG,
			permitCap: "5000",
		});

		const account = privateKeyToAccount(VALID_PRIVATE_KEY as `0x${string}`);
		const decoded = JSON.parse(Buffer.from(permit.paymentSig, "base64").toString("utf8")) as {
			x402Version: number;
			accepted: {
				scheme: string;
				network: string;
				asset: string;
				payTo: string;
				extra?: { name?: string; version?: string };
			};
			payload: {
				authorization: {
					from: string;
					to: string;
					value: string;
					nonce: string;
					validBefore: string;
				};
				signature: string;
			};
		};

		expect(decoded.x402Version).toBe(2);
		expect(decoded.accepted).toEqual({
			scheme: "upto",
			network: "eip155:8453",
			asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			payTo: "0x1363C7Ff51CcCE10258A7F7bddd63bAaB6aAf678",
			extra: {
				name: "USD Coin",
				version: "2",
			},
		});
		expect(decoded.payload.authorization).toEqual({
			from: account.address,
			to: "0x1363C7Ff51CcCE10258A7F7bddd63bAaB6aAf678",
			value: "5000",
			nonce: "7",
			validBefore: "1700000300",
		});
		expect(decoded.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);

		expect(permit.deadline).toBe(1_700_000_300);
		expect(permit.nonce).toBe("7");
		expect(permit.maxValue).toBe("5000");
	});
});
