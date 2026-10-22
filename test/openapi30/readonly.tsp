import "@typespec/http";
using Http;
/**
 * A server-assigned read-only `id` sent in a create body, directly and nested - see `openapi30.test.ts`.
 */
@service(#{ title: "RO" })
namespace RO;
model Item { @visibility(Lifecycle.Read) id: string; label: string; }
model Widget {
  @visibility(Lifecycle.Read) id: string;
  name: string;
  items: Item[];
}
model Order { @visibility(Lifecycle.Create) secret: string; widget: Widget; }
@route("/widgets") @post op create(@body widget: Widget): { @statusCode _: 201; @body body: Widget };
@route("/widgets") @get op list(): Widget[];
@route("/orders") @post op order(@body order: Order): void;
