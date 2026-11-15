// QA-only: bundles real src/sim modules for Node replay/adversarial checks.
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../../../..');
export default { root, configFile: false,
  build: { ssr: resolve(import.meta.dirname, 'node-entry.ts'), outDir: resolve(import.meta.dirname, '../node-bundle'), emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'sim.mjs' } } } };
