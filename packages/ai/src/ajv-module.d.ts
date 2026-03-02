declare module "ajv" {
	export interface AjvErrorObject {
		instancePath?: string;
		message?: string;
		keyword?: string;
		params?: Record<string, unknown>;
	}

	export interface AjvValidateFunction<T = unknown> {
		(data: unknown): data is T;
		errors?: AjvErrorObject[] | null;
	}

	export interface AjvOptions {
		[key: string]: unknown;
	}

	export default class Ajv {
		constructor(options?: AjvOptions);
		compile<T = unknown>(schema: unknown): AjvValidateFunction<T>;
	}
}
