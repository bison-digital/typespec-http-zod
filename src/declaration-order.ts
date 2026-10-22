import {
	getSourceLocation,
	type Interface,
	type Namespace,
	type Operation,
	type Program,
	type Type,
} from "@typespec/compiler";
import type { HttpService } from "@typespec/http";

/**
 * **What this package writes is ordered by where the spec declares it, not by when the checker
 * reached it.**
 *
 * The compiler files each member of a namespace when the checker reaches it: an interface once its
 * operations are checked, a model once its heritage is (before its properties, so it can name
 * itself), an enum once its members are, a namespace when it is first named. A type is checked early
 * wherever something checked before it names it, so the order of `namespace.interfaces` - and of
 * `@typespec/http`'s operations, which `listOperationsIn` reads from it - depends on what other code
 * names a type, not only on what is declared. Measured on `@typespec/compiler` 1.17.0: a second file
 * whose only statement is an augment decorator naming an operation, `@@names(Widget, Gadgets.read)`,
 * checks `Gadgets` with `Widget`, before the `Status` and `Widgets` interfaces declared ahead of it,
 * and every route, validator and request of the service moved. `@typespec/openapi3` stays still only
 * because it sorts its paths and components by key (`sortOpenAPIDocument`).
 *
 * **Only what is written is ordered.** Which reference reaches a shared schema first is openapi3's
 * emission order, the checker's, and `published.ts` mirrors it from the service as `@typespec/http`
 * lists it, so the walk that decides a schema's content keeps that order. These functions order the
 * walks whose only effect is where a declaration lands in a file.
 *
 * A declaration's place is its source file, in the order the program loaded its files, then its
 * position in that file. Where a spec declares every type before anything names it, the checker
 * reaches them in that order, and the output is what it was. A type named before it is declared was
 * written where it was first named, and is now written where it is declared.
 */

/** A type's place in the spec, where it has one: `[file, position]`. */
type Place = readonly [number, number];

const PLACES = new WeakMap<Program, ReadonlyMap<string, number>>();

/** Each source file's place in the order the program loaded them. */
function filePlacesOf(program: Program): ReadonlyMap<string, number> {
	let places = PLACES.get(program);
	if (places === undefined) {
		places = new Map([...program.sourceFiles.keys()].map((path, index) => [path, index]));
		PLACES.set(program, places);
	}
	return places;
}

function placeOf(program: Program, type: Type): Place | undefined {
	if (type.node === undefined) return undefined;
	const location = getSourceLocation(type.node);
	const file = filePlacesOf(program).get(location.file.path);
	return file === undefined ? undefined : [file, location.pos];
}

/**
 * `types` by where each is declared. **Stable**, and a type with no place in the spec (one the
 * compiler made) keeps its place among the others' as they came, after them.
 */
export function inDeclarationOrder<T extends Type>(program: Program, types: Iterable<T>): T[] {
	return byDeclarationOf(program, types, (type) => type);
}

/** `items` by where the type each stands for is declared, as `inDeclarationOrder` orders types. */
export function byDeclarationOf<T>(
	program: Program,
	items: Iterable<T>,
	typeOf: (item: T) => Type,
): T[] {
	const placed = [...items].map((item, index) => ({
		item,
		index,
		place: placeOf(program, typeOf(item)) ?? ([Infinity, Infinity] as const),
	}));
	placed.sort((a, b) => a.place[0] - b.place[0] || a.place[1] - b.place[1] || a.index - b.index);
	return placed.map(({ item }) => item);
}

/**
 * **`@typespec/http`'s operations of a service, in the order its namespaces declare them.** The
 * grouping is `listOperationsIn`'s, kept: a namespace's own operations, then its namespaces, then its
 * interfaces, each interface's operations as the checker builds them, bases' first. Only what the
 * checker files as it reaches it, a namespace's operations, namespaces and interfaces, is put back in
 * the order it is declared: an interface builds its own operations in the order it declares them.
 */
export function inDeclaredOperationOrder(program: Program, service: HttpService): HttpService {
	const rank = new Map<Operation, number>();
	const visit = (container: Namespace | Interface): void => {
		if (container.kind === "Interface") {
			for (const operation of container.operations.values()) rank.set(operation, rank.size);
			return;
		}
		for (const operation of inDeclarationOrder(program, container.operations.values())) {
			rank.set(operation, rank.size);
		}
		for (const child of [
			...inDeclarationOrder(program, container.namespaces.values()),
			...inDeclarationOrder(program, container.interfaces.values()),
		]) {
			visit(child);
		}
	};
	visit(service.namespace);
	const operations = service.operations
		.map((operation, index) => ({ operation, index }))
		.sort(
			(a, b) =>
				(rank.get(a.operation.operation) ?? Infinity) -
					(rank.get(b.operation.operation) ?? Infinity) || a.index - b.index,
		)
		.map(({ operation }) => operation);
	return { ...service, operations };
}
