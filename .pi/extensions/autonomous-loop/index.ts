import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorkflowHooks } from "./hooks.js";

export default function autonomousLoopExtension(pi: ExtensionAPI): void {
	const workflow = registerWorkflowHooks(pi);

	pi.registerCommand("workflow", {
		description: "Autonomous workflow controls: status|advance|reset|findings|load <path>",
		handler: async (args, ctx) => {
			const input = args.trim();
			const [command, ...rest] = input.length > 0 ? input.split(/\s+/) : ["status"];

			if (command === "status") {
				ctx.ui.notify(workflow.status(), "info");
				return;
			}

			if (command === "findings") {
				ctx.ui.notify(workflow.findings(), "info");
				return;
			}

			if (command === "reset") {
				ctx.ui.notify(workflow.reset(ctx), "warning");
				return;
			}

			if (command === "advance") {
				const targetPhase = rest[0];
				const message = workflow.advance(targetPhase, ctx);
				ctx.ui.notify(message, /failed|cannot|invalid/i.test(message) ? "warning" : "info");
				return;
			}

			if (command === "load") {
				const path = rest.join(" ").trim();
				if (!path) {
					ctx.ui.notify("Usage: /workflow load <path-to-prd.md>", "warning");
					return;
				}
				const message = await workflow.loadPrdFromPath(path, ctx);
				ctx.ui.notify(message, /failed|not readable/i.test(message) ? "warning" : "info");
				return;
			}

			ctx.ui.notify("Usage: /workflow status|advance [phase]|reset|findings|load <path>", "warning");
		},
	});
}
