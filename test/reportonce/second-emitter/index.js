// A second emitter built on this library, as typespec-hono is: it calls the published entry point.
import { emitHttpZod } from "typespec-http-zod";

export async function $onEmit(context) {
	await emitHttpZod(context);
}
