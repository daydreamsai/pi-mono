import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PermitCache } from "./src/cache.js";
import type { EnvSource } from "./src/env.js";
import { loadX402Env } from "./src/env.js";
import { createRouterConfigResolver } from "./src/router-config-resolver.js";
import { createViemSigner } from "./src/signer.js";
import { buildX402StreamOptions } from "./src/stream-options.js";
import type { X402EnvConfig } from "./src/types.js";

const X402_API = "x402-openai-completions";

function withV1Path(origin: string): string {
	return origin.endsWith("/") ? `${origin}v1` : `${origin}/v1`;
}

function createX402Stream(
	env: X402EnvConfig,
	staticPaymentSignature?: string,
): (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream {
	const permitCache = new PermitCache();
	const resolveRouterConfig = createRouterConfigResolver({
		routerUrl: env.routerUrl,
		network: env.network,
		paymentHeader: env.paymentHeader,
	});
	const signer = createViemSigner();

	return (model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream => {
		const openAIModel = {
			...model,
			api: "openai-completions",
		} as Model<"openai-completions">;
		// OpenAI client adds Authorization from apiKey; set null to explicitly clear it.
		const headers = {
			...(options?.headers ?? {}),
			Authorization: null,
		} as Record<string, string | null>;

		const baseOptions = {
			...(options ?? {}),
			headers,
		};
		const x402Options = staticPaymentSignature
			? buildX402StreamOptions(baseOptions, {
					routerUrl: env.routerUrl,
					permitCap: env.permitCap,
					staticPaymentSignature,
					paymentHeader: env.paymentHeader,
				})
			: (() => {
					if (!env.privateKey) {
						throw new Error("X402_PRIVATE_KEY is required unless X402_PAYMENT_SIGNATURE is set");
					}
					return buildX402StreamOptions(baseOptions, {
						routerUrl: env.routerUrl,
						permitCap: env.permitCap,
						privateKey: env.privateKey,
						resolveRouterConfig,
						permitCache,
						signer,
					});
				})();

		return streamSimpleOpenAICompletions(openAIModel, context, {
			...x402Options,
			apiKey: options?.apiKey ?? "x402-placeholder",
		} as SimpleStreamOptions);
	};
}

export function registerX402Provider(pi: ExtensionAPI, envSource: EnvSource = process.env): void {
	const staticPaymentSignatureRaw = envSource.X402_PAYMENT_SIGNATURE?.trim();
	const staticPaymentSignature =
		typeof staticPaymentSignatureRaw === "string" && staticPaymentSignatureRaw.length > 0
			? staticPaymentSignatureRaw
			: undefined;
	const env = loadX402Env(envSource, {
		requirePrivateKey: !staticPaymentSignature,
	});
	const headers = staticPaymentSignature
		? {
				[env.paymentHeader]: staticPaymentSignature,
			}
		: undefined;
	const streamX402 = createX402Stream(env, staticPaymentSignature);

	pi.registerProvider("x402", {
		baseUrl: withV1Path(env.routerUrl),
		apiKey: "x402-placeholder",
		api: X402_API,
		streamSimple: streamX402,
		headers,
		models: [
			{
				id: env.modelId,
				name: env.modelName,
				reasoning: true,
				input: ["text", "image"],
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: 200000,
				maxTokens: 32768,
				compat: {
					supportsDeveloperRole: false,
				},
			},
		],
	});
}

export default function registerX402(pi: ExtensionAPI): void {
	registerX402Provider(pi, process.env);
}
