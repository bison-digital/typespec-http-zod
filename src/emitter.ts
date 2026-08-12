import type { EmitContext } from "@typespec/compiler";
import { emitHttpZod } from "./api.js";

/**
 * This library's own emitter entry point.
 *
 * ⚠️ **It may import `./api.js`, `./lib.js` and external packages, and nothing else — asserted, not
 * intended.** An emitter built on this library is written exactly like this one, so "the public API
 * is sufficient to build an emitter on" is proved by construction rather than hoped for. The moment
 * this file needs something `api.ts` does not export, the API is wrong and the fix belongs there.
 *
 * That it is one line is the point, not a shortcut: everything this package does is reachable
 * through a single published call, so a server generator adds its own file and nothing else.
 */
export async function $onEmit(context: EmitContext): Promise<void> {
	await emitHttpZod(context);
}
