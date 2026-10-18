# txiki.js

The JavaScript runtime Rome runs plugins in. It is a child process, not a
library: a plugin that calls `tjs.exit()`, or a bug in the C engine underneath
it, must not be able to take the reader down with it.

Upstream: <https://github.com/saghul/txiki.js>

## What is here

    vendor/txiki/
      LICENSE                      upstream's, copied verbatim
      aarch64-apple-darwin/tjs     the binary for that target triple
      README.md                    this file

One directory per target triple. The application looks for the triple matching
the platform it is running on, so more than one can be vendored side by side
(see `runtime_path` in `src/plugin/sidecar.rs`). Nothing else needs to change to
add one.

## Version

| | |
| --- | --- |
| Engine version (`tjs --version`) | `v26.6.0` |
| Upstream commit | `8a9b6044dc5eff2c57e7f8876a420cc24c36be7a` |
| `git describe` at that commit | `v26.6.0-136-g8a9b6044` |
| Commit date | 2026-10-17 |
| Target triple | `aarch64-apple-darwin` |
| SHA-256 | `669343231798868ee6450b12cdcd82fe6a4faf2d26cb374bcd7a4b38e51f2fe9` |
| Size | 6311968 bytes |

`tjs --version` reports `v26.6.0`, the tag the build is based on; the checkout
is 136 commits past that tag. Both are recorded because the tag alone does not
identify the source that produced this binary — the commit does.

## How it was built

    git clone --recursive --shallow-submodules https://github.com/saghul/txiki.js
    cd txiki.js
    make -j8

`make` configures CMake and builds `build/tjs`; the binary is copied here
unchanged. `--recursive --shallow-submodules` is required — txiki.js vendors
QuickJS-ng, libuv and mimalloc as submodules, and a plain clone builds a
different (or no) engine.

Building it needs three things: a C toolchain, CMake, and Node. The Makefile
bundles the standard library with `npx esbuild` before compiling it into the
binary, so a machine with no `npx` fails partway through rather than at the
start. None of that is needed to build Rome — this is only what it takes to
produce a replacement for the binary below.

On macOS the result links only against system libraries — `libSystem`,
`libffi`, `libc++` — so it is self-contained apart from the OS itself.

## License

MIT. Copyright (c) 2019-present Saúl Ibarra Corretgé. The full text is in
`LICENSE`, next to this file, which is where a redistribution has to keep it.

## Why the binary is committed

It could be fetched or built on demand. It is committed instead for two
reasons:

- **No network at build time.** Building Rome must not depend on GitHub being
  reachable, on a submodule fetch succeeding, or on a C toolchain being present
  on the machine. Committing the binary makes `cargo build` the only step.
- **Reproducibility.** Plugins are written against a specific engine, and the
  one they were tested against has to be the one that runs them. A binary
  downloaded at build time is a binary that can change underneath a build
  without the repository recording it; the hash above is what pins it.

The cost is a 6 MB file in the repository, which is the right trade for a
desktop application that ships this binary in its bundle anyway.

## Working on the runtime itself

`ROME_TJS` overrides the lookup, so a local build can be used without touching
this directory:

    ROME_TJS=/tmp/txiki.js/build/tjs cargo run
