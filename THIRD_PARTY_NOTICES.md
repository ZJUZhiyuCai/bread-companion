# Attribution and third-party notices

Bread's original source, documentation, embedded SVG character illustrations and synthetic evaluation scenarios are distributed under [MIT](LICENSE). Third-party packages retain their own licenses; MIT does not relicense them or grant rights to provider models, voices, trademarks or services.

| Component | Source | License |
| --- | --- | --- |
| Next.js | [vercel/next.js](https://github.com/vercel/next.js) | MIT |
| React / React DOM | [facebook/react](https://github.com/facebook/react) | MIT |
| Lucide icons | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | ISC; includes inherited Feather icons under MIT |
| Zod | [colinhacks/zod](https://github.com/colinhacks/zod) | MIT |
| TypeScript, Playwright | [microsoft](https://github.com/microsoft) | Apache-2.0 |
| Vitest | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) | MIT |
| axe-core | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) | MPL-2.0 |
| fake-indexeddb | [dumbmatter/fakeIndexedDB](https://github.com/dumbmatter/fakeIndexedDB) | Apache-2.0 |

Exact versions and package license metadata are in `package-lock.json`; upstream distributions include their license texts. No vendored dependency tree or provider model weights are distributed here.

The small [voice test fixture](tests/fixtures/README.md) is synthetic MiniMax output of an original test phrase, not a human recording. It is supplied as test data; this repository does not license MiniMax's voice model, voice identity, or hosted synthesis service. API users must follow their own provider agreement. The [MiniMax platform terms](https://platform.minimax.io/protocol/terms-of-service) are separate from the software license.

Frontend design and illustrations were produced with official Claude Code; Codex integrated backend, tests and correctness fixes under the maintainer's direction. The design provenance JSON files in `docs/` preserve original file hashes and integration notes. Repository screenshots show this application and contain no user conversation. Competitor logos, screenshots and assets are not copied into the product.
