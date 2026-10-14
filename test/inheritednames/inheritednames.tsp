import "@typespec/http";

using Http;

/**
 * **A property named after something every JavaScript object inherits.**
 *
 * Zod reads a property's value as `input[key]`, so for an object that leaves out an optional
 * `constructor`, it reads the inherited `Object.prototype.constructor` - a function - and refuses
 * the object (colinhacks/zod#6666). Every `Object.prototype` name does this except `__proto__`,
 * which Zod skips on purpose (colinhacks/zod#6386): a property named `__proto__` is never validated
 * at all. And an object literal keyed `__proto__:` does not declare a key - it sets the shape's
 * prototype - so under `seal-object-schemas` every body that carried one was refused as an
 * unrecognised key.
 *
 * Neither is something the emitted code can repair without giving up `.shape`, so each is reported
 * where it bites, and the controls beside them are not.
 */
@service(#{ title: "Inherited names" })
namespace InheritedNames;

model Widget {
  id: string;
  constructor?: string;
  toString?: string;
  valueOf?: int32 = 1;

  /** Required, which Zod handles - except where a PATCH makes it optional. */
  hasOwnProperty: string;

  @encodedName("application/json", "isPrototypeOf")
  renamed?: string;

  /** Controls: near misses, and an inherited name only in TypeSpec, not on the wire. */
  proto?: string;
  __proto?: string;
  @encodedName("application/json", "plainName")
  propertyIsEnumerable?: string;
}

model Prototyped {
  id: string;
  __proto__: string;
}

@route("/widgets")
@post
op createWidget(@query constructor?: string, @body body: Widget): Widget;

@route("/widgets")
@patch
op updateWidget(
  @header contentType: "application/merge-patch+json",
  @body body: MergePatchUpdate<Widget>,
): Widget;

@route("/prototyped")
@post
op createPrototyped(@body body: Prototyped): Prototyped;
