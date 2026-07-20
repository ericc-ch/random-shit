## Coding Style

- Use `main.ts` / `main.tsx` for module entry points (barrel files, package roots). Do not use `index.ts` / `index.tsx`.
- Never explicitly write types unless needed. Prefer type inference.
- Extract a helper only when reused or when duplication is worse than indirection. Avoid splitting logic into small named pieces for "structure".
- Prefer cohesive files over micro-modules. Don't create a new file for a one-off helper, a single export, or a few lines that only one caller uses — keep that logic in the file it belongs to. Split only when a module has a clear boundary (e.g. an adapter, a shared handler) or when reuse across callers justifies it.
- Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.
- Minimize nesting.
- Do not throw away useful data early. Pass raw data through unless there is a clear reason to change its shape.
- Keep display logic in the UI. Services should produce state; UI components should decide how to show it.
- Keep one shape for one idea. Do not keep separate raw, summary, preview, and display fields unless they are truly different contracts.
- Make abstractions earn their place. Inline simple code until reuse, complexity, or a clear boundary makes a helper worthwhile.
- Update tests to match the current behavior. Do not keep old convenience behavior alive just to avoid changing tests.

## Effect

- Use `Effect.gen` and `yield*` for business logic. Use `.pipe` for composition and simple transforms. Use both together.
- Use `Effect.fn` for functions that return an effect. Do not return `Effect.gen(...)` from a plain function.
- Do not `.pipe` on `Effect.fn`. Pass handlers (`Effect.catch`, `Effect.ensuring`, etc.) as additional arguments to `Effect.fn`.
- Use `Effect.gen` for: injecting and retrieving dependencies, conditionals, multi-step sequential operations.
- Do not chain `.map`, `.flatMap`, or `.andThen` for sequential logic.
- Use `.pipe` for: error handling, tracing, layer building, simple transforms.
- Business logic inside the generator; cross-cutting concerns outside with `.pipe` (or as extra `Effect.fn` arguments).

## Testing

- Write fewer tests. Prefer integration tests.
- Do not compromise production code for testing (no test-only hooks, exports, flags, or abstractions). Adapt the tests, not the product.
- Do not test what the type system guarantees (e.g., schema shapes, literal unions, trivial getters).
- Test behavior that can actually regress.
