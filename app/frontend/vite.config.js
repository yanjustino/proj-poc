import { defineConfig, searchForWorkspaceRoot } from 'vite';

// reading-pane.js imports the artifact page shell straight from the repo's
// workflows/ (outside this package) so the in-app preview always uses the
// current artifact CSS — the dev server has to be allowed to serve it.
export default defineConfig({
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), '../../workflows/shared/artifacts'],
    },
  },
});
