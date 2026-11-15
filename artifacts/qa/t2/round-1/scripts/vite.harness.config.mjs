// QA-only: bundles /qa/t2.html + module worker without touching tracked build config.
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../../../..');
export default { root, configFile: false, logLevel: 'info',
  build: { outDir: resolve(import.meta.dirname, '../harness-dist'), emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'qa/t2.html') } } };
