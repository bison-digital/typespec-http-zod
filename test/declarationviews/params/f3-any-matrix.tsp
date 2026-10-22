import "@typespec/http";

using Http;

@service(#{ title: "F3" })
namespace F3;

scalar Anything;

@route("/a/{;v*}") @get op a(@path v: unknown): void;
@route("/b/{;v*}") @get op b(@path v: Anything): void;
@route("/c/{;v*}") @get op c(@path v: string | unknown): void;
@route("/d/{;v*}") @get op d(@path v: int32[] | string): void;
@route("/e/{;v*}") @get op e(@path v: Record<int32> | string): void;
@route("/f/{;v*}") @get op f(@path v: int32[] | unknown): void;
