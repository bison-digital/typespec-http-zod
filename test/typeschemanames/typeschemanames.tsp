import "@typespec/http";

using Http;

/**
 * The identifier each declared type's validator is exported under, as `EmittedService.typeSchemaNames`
 * publishes it: one per type, the declaration under the type's own component name.
 */
@service(#{ title: "Type schema names" })
namespace TypeSchemaNames;

/** A base whose subtype adds a required property: only the subtype's validator tells them apart. */
union DogKind {
  string,
  Golden: "golden",
}

@discriminator("kind")
model Dog {
  kind: DogKind;
  weight: int32;
}

model Golden extends Dog {
  kind: DogKind.Golden;
  coat: string;
}

/** A subtype that only narrows a property, which no shape check can see. */
@discriminator("kind")
model Pet {
  kind: string;
  age: int32;
}

model Puppy extends Pet {
  kind: "puppy";
  @maxValue(1) age: int32;
}

/** A nested base: each level is a dispatch of its own, and no operation names `SawShark`. */
@discriminator("kind")
model Fish {
  kind: string;
  age: int32;
}

@discriminator("sharktype")
model Shark extends Fish {
  kind: "shark";
  sharktype: string;
}

model SawShark extends Shark {
  sharktype: "saw";
  teeth: int32;
}

model Salmon extends Fish {
  kind: "salmon";
}

/** Published as `Canine`, so validated by `canineSchema`. */
@friendlyName("Canine")
model Hound {
  name: string;
}

/** A name TypeScript reserves, declared with a trailing `_`. */
model `default` {
  value: string;
}

/** Sent with a create-only property and returned without it: the create body is `WidgetCreate`. */
model Widget {
  @visibility(Lifecycle.Read) id: string;
  @visibility(Lifecycle.Create) secret: string;
  name: string;
  color: Color;
}

/**
 * One component at every version, its `id` read-only: OAS 3.0 reads it apart for a request, so a 3.0
 * module declares `GadgetCreate` beside it.
 */
model Gadget {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}

enum Color {
  red,
  blue,
}

/** Two models of one name rendered alike: the module declares `pairSchema` once, for both. */
namespace Left {
  model Pair {
    x: string;
  }
}

namespace Right {
  model Pair {
    x: string;
  }
}

model Pairs {
  left: Left.Pair;
  right: Right.Pair;
}

/** A multipart body's model, published under its own name and validated as the form it is. */
model Upload {
  title: HttpPart<string>;
  file: HttpPart<File>;
}

/** Only ever sent, at two visibilities that reshape it: published as views alone, so no entry. */
model Draft {
  @visibility(Lifecycle.Create) origin: string;
  @visibility(Lifecycle.Update) revision: int32;
  title: string;
}

/** No operation reaches it, and openapi3 publishes it all the same. */
model Orphan {
  note: string;
}

@route("/dog") @get op dog(): Dog;
@route("/pet") @get op pet(): Pet;
@route("/fish") @get op fish(): Fish;
@route("/hound") @get op hound(): Hound;
@route("/default") @get op getDefault(): `default`;
/** Read first, so the create view is declared after the type's own declaration. */
@route("/widgets/{id}") @get op getWidget(@path id: string): Widget;
@route("/widgets") @post op createWidget(@body widget: Widget): Widget;
@route("/gadgets") @post op createGadget(@body gadget: Gadget): Gadget;
@route("/pairs") @get op pairs(): Pairs;
@route("/drafts") @post op createDraft(@body draft: Draft): void;
@route("/drafts/{id}") @put op replaceDraft(@path id: string, @body draft: Draft): void;
@route("/uploads") @post op upload(
  @header contentType: "multipart/form-data",
  @multipartBody body: Upload,
): void;
