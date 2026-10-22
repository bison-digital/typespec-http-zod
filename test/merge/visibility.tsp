import "@typespec/http";

using Http;

/**
 * A create-only property, which makes the create body its own projection, and a read-only one,
 * which openapi3 shares into the request as `readOnly` - required there too, under OAS 3.1.
 */
@service(#{ title: "Visibility" })
namespace Visibilities;

model Gadget {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}

model Entry {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}

@route("/gadgets") @post op createGadget(@body body: Gadget): Gadget;
@route("/gadgets") @get op readGadget(): Gadget;
@route("/entries") @post op createEntry(@body body: Entry): Entry;
