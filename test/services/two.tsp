import "@typespec/http";

using Http;

/**
 * Two `@service` namespaces in one spec, which is how a project publishes two surfaces from a
 * single source.
 *
 * Both once emitted into the same directory under the same file name, so the second silently
 * overwrote the first and one whole surface lost its validators with no diagnostic.
 */
@service(#{ title: "Widgets" })
namespace WidgetApi {
  model Widget {
    id: string;
    secret: string;
  }

  @route("/widgets")
  @get
  op listWidgets(): Widget[];
}

@service(#{ title: "Articles" })
namespace ArticleApi {
  model Article {
    slug: string;
  }

  @route("/articles")
  @get
  op listArticles(): Article[];
}
