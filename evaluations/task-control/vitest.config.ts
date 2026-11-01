import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } }, test: { include: ['evaluations/task-control/run.test.ts'], environment: 'node', testTimeout: 600000 } });
