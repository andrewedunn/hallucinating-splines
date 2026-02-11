# Attribution

Hallucinating Splines is built on open-source software. This file credits the upstream projects and authors.

## Micropolis

The simulation engine is based on **Micropolis**, the open-source city simulation engine released by Maxis/Electronic Arts.

- Original game by Will Wright
- Open-source release by Don Hopkins / Electronic Arts
- Repository: https://github.com/SimHacker/micropolis

## micropolisJS

The engine code in `src/engine/` is extracted from **micropolisJS**, a JavaScript port of Micropolis by Graeme McCutcheon.

- Author: Graeme McCutcheon
- Repository: https://github.com/graememcc/micropolisJS
- License: GPL-3.0 with EA additional terms (see LICENSE)

Three files were patched from upstream (documented in CLAUDE.md).

## License Obligations

This project inherits the GPL-3.0 license from micropolisJS for all engine code. The full license text and EA additional terms are in the LICENSE file.

Per the GPL-3.0 and EA additional terms:
- The trademark "SimCity" is not used in this project
- Modified files are marked as such
- The EA disclaimer and additional terms are preserved
