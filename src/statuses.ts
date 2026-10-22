/**
 * **The status codes a server can answer with, by class.** A `4XX` range or a `default` response
 * means "every code in these classes that nothing more specific claims", and a type for such a
 * result needs those codes spelled out: `number` would admit `999`, and a type that admits a status
 * no server can send is a type no client can narrow on.
 *
 * **One list, owned here, because two server emitters each held a copy.** `typespec-hono` and
 * `typespec-http-mcp` both typed a ranged or `default` result from their own table, and the contract
 * types in `requests.gen.ts` need the same one to state a result a backend can hand straight to
 * either. Three copies of a table that must agree are three tables that will not.
 *
 * **Graded outside this package, against Hono's own `http-status.d.ts`,** by the two emitters that
 * serve through it - an expectation that does not come from the code it grades. A code Hono adds
 * turns their arm red here first.
 */
export const STATUS_CODES = {
	1: [100, 101, 102, 103],
	2: [200, 201, 202, 203, 204, 205, 206, 207, 208, 226],
	3: [300, 301, 302, 303, 304, 305, 306, 307, 308],
	4: [
		400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418,
		421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
	],
	5: [500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511],
} as const;

/** The codes a response cannot carry a body under, per RFC 9110: 101, 204, 205 and 304. */
export const CONTENTLESS_STATUS_CODES = [101, 204, 205, 304] as const;
