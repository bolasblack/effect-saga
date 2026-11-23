# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-23

### Breaking changes

- Require `effect@^4.0.6`. For TypeScript projects, use TypeScript 5.9 or later with `strict` enabled.
  Replace Effect v3 APIs such as `Context.Tag` and `Effect.fork` with `Context.Service` and
  `Effect.forkChild`. [Effect v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- The native ESM entry exposes named exports. If you used `import effectSaga from 'effect-saga'`
  in Node.js, switch to named imports such as `import { createEffectSagaRunner } from 'effect-saga'`.
- CommonJS `require('effect-saga')` requires Node.js support for `require(esm)`.
  Node.js enables it by default starting with 20.19 on the 20.x line and 22.12 on the 22.x line.
  [Node.js module loading](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)
- Use the package root for public APIs. Imports under `effect-saga/src/` and `effect-saga/dist/`
  now require a file extension. If you imported `makeSagaRuntime` from `src`, use
  `createEffectSagaRunner` for sagas or `ManagedRuntime.make` with `makeStoreService` to run
  effects that need the Redux store.
- Each layer passed in `extraLayers` needs all its dependencies provided. Use `Layer.provide`
  to supply those dependencies before passing the layer to `createEffectSagaRunner`.
- A failure in `combineSagas` interrupts running sagas and can skip sagas that have yet to start.
  Handle failures within each saga if the other sagas need to keep running.
- `Effect.runPromise(Effect.fail('boom'))` now rejects with `'boom'`. If your code checks for a
  `FiberFailure` wrapper, use `Effect.runPromiseExit` to inspect the full cause. The runner's
  `onError` callback receives an `Exit.Failure`.

### Changed

- Keep scoped layers alive across `switchSaga` calls. Release the layers when the active saga
  finishes or the runner stops.
- Skip `start()` calls while the runner has an active saga.

## [0.1.0] - 2025-08-10

### Added

- Initial release of effect-saga library
