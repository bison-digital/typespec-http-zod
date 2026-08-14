import "@typespec/http";

using Http;

/**
 * **A declared TYPE is a claim about the value, and the validator must honour it.**
 *
 * `utcDateTime` is not a string with a hint attached: it is a scalar TypeSpec resolves to
 * `format: date-time` in the document. Emitting `z.string()` for it discarded a declared type, so a
 * service promising a timestamp accepted `banana`, and a consumer who wanted the check had to
 * rewrite the spec as `string` with a `@pattern` - losing `format: date-time` from the document AND
 * getting a weaker check, since a hand-written pattern accepts `2026-02-31`.
 *
 * **`@format("...")` on a plain string is the other case and is NOT enforced.** Under JSON Schema
 * 2020-12, which OpenAPI 3.1 uses, `format` is an annotation rather than an assertion, so enforcing
 * an author's hint would add a rule the contract does not state. `@format("account-number")` is the
 * case proving no general rule exists. A type is a claim; an annotation is a hint.
 *
 * **The options matter and were measured rather than assumed.** A bare `z.iso.datetime()` REJECTS
 * `2026-08-14T12:00:00+01:00`, which is valid RFC 3339 and valid `format: date-time`, so it would
 * have refused conformant callers - the exact defect class this package exists to remove.
 * `{ offset: true }` accepts every legal instant and still rejects `2026-02-31` and `banana`.
 */
@service(#{ title: "Formats" })
namespace Formats;

model Thing {
  when: utcDateTime;
  link: url;
  /** The control: a plain string stays a plain string. */
  plain: string;
  /** The other control: an ANNOTATION is a hint and is not enforced. */
  @format("uuid")
  id: string;
}

@route("/things")
@post
op create(@body body: Thing): Thing;
