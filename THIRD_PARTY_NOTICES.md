# Attribution and third-party notices

Bread's original source, documentation, embedded SVG character illustrations and synthetic evaluation scenarios are distributed under [MIT](LICENSE). Third-party packages retain their own licenses; MIT does not relicense them or grant rights to provider models, voices, trademarks or services.

| Component | Source | License |
| --- | --- | --- |
| Next.js | [vercel/next.js](https://github.com/vercel/next.js) | MIT |
| React / React DOM | [facebook/react](https://github.com/facebook/react) | MIT |
| Lucide icons | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | ISC; includes inherited Feather icons under MIT |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
| Bread Voice font subsets | [LXGW WenKai Screen v1.530](https://github.com/lxgw/LxgwWenKai-Screen/releases/tag/v1.530) by LXGW | [SIL OFL 1.1](public/design/fonts/OFL-LXGW.txt); modified family renamed Bread Voice |
| Vinext / Vite / Drizzle ORM | [Vinext](https://github.com/cloudflare/vinext), [Vite](https://github.com/vitejs/vite), [Drizzle](https://github.com/drizzle-team/drizzle-orm) | MIT; deployment adapter only |
| Zod | [colinhacks/zod](https://github.com/colinhacks/zod) | MIT |
| TypeScript, Playwright | [microsoft](https://github.com/microsoft) | Apache-2.0 |
| Vitest | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) | MIT |
| axe-core | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) | MPL-2.0 |
| fake-indexeddb | [dumbmatter/fakeIndexedDB](https://github.com/dumbmatter/fakeIndexedDB) | Apache-2.0 |

Exact versions and package license metadata are in `package-lock.json`; upstream distributions include their license texts. No vendored dependency tree or provider model weights are distributed here.

The small [voice test fixture](tests/fixtures/README.md) is synthetic MiniMax output of an original test phrase, not a human recording. It is supplied as test data; this repository does not license MiniMax's voice model, voice identity, or hosted synthesis service. API users must follow their own provider agreement. The [MiniMax platform terms](https://platform.minimax.io/protocol/terms-of-service) are separate from the software license.

Frontend design and illustrations were produced with official Claude Code, with subsequent frontend and telephone refinements contributed through DeepSeek; Codex integrated backend, tests and correctness fixes under the maintainer's direction. The design provenance JSON files in `docs/` preserve original file hashes and integration notes. Repository screenshots show this application and contain no user conversation. Competitor logos, screenshots and assets are not copied into the product.

The new plush body is an original asset generated with the built-in image-generation tool; its moving eyes and red telephone are code-rendered. The short opening voice is synthetic MiniMax speech, not a human recording. [Asset provenance and generation prompt](docs/living-companion-assets.md) document both. The user-supplied reference photograph is not distributed.

The procedural 3D telephone is authored for Bread with Blender and rendered with Three.js. Its generator is `scripts/3d/build_companion.py`; dial numerals are Blender built-in text converted to mesh. No external phone model, font file, texture, or HDR environment is bundled. Blender is a separate GPL-licensed authoring tool; its output is covered by its [artwork policy](https://www.blender.org/about/license/), not automatically by the program license. The SVG remains the fallback. [Functional audit](docs/phone3d-audit.md) records the candidate validation and remaining work.

Self-hosted font source, subsetting and attribution are documented in [fonts.md](docs/fonts.md). The font retains OFL 1.1 and is not relicensed under the project MIT license.
