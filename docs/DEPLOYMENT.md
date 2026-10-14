# Frontend deployment

The public frontend is an informational site and a browser-memory simulation. It cannot deposit, withdraw, sign, connect a wallet, generate a proof or send a blockchain transaction. The Solidity protocol remains an unaudited development reference.

## Build boundary

`scripts/build-frontend.mjs` copies exactly seven public files from `frontend/` into `dist/`: HTML, CSS, JavaScript, the SVG mark and robots policy. It never copies the repository wholesale. Vercel's `outputDirectory` is `dist`; the build does not run npm install, the keeper, contract deployment or circuit setup.

`.vercelignore` limits CLI uploads to the frontend, build script and Vercel configuration. Git-based deployments clone the public source repository but serve only the allowlisted output. `.gitignore` excludes environment values, Vercel local state, dependencies, proving keys, witness files, private notes and generated protocol artifacts. `.env.example` contains placeholders only and belongs in source control.

Vercel CLI may create `.env.local` during linking. Treat that file as a credential-bearing local file; do not print, stage or upload it. Authentication uses the existing GitHub and Vercel credential stores. No deployment token is embedded in commands or source.

## Hosting configuration

- Vercel project: `ciphershroud`, in the `sativuscrocuss-projects` scope.
- Git repository: `https://github.com/SativusCrocus/SHROUD`.
- Production branch: `main`.
- Framework preset: Other / none.
- Install command: `node --version` (no dependency installation).
- Build command: `node scripts/build-frontend.mjs`.
- Public output: `dist`.
- Runtime environment variables: none required by the frontend.

Publish an authorized release from the repository root using the authenticated CLI:

```bash
npm run test:frontend
vercel deploy --dry --json --scope sativuscrocuss-projects
vercel deploy --prod --scope sativuscrocuss-projects
```

The Vercel Git integration also builds changes pushed to the connected production branch. Inspect the resulting deployment and its production alias before treating a release as complete.

## Browser restrictions

`vercel.json` supplies CSP, `nosniff`, `DENY` framing, no-referrer, restricted browser permissions and HSTS. The CSP permits only same-origin scripts, styles, fonts and images, and sets `connect-src 'none'`. It prohibits inline scripts, dynamic evaluation, frames and form submissions. The frontend makes no analytics or third-party resource requests. Vercel still processes normal hosting requests and may retain infrastructure logs under the account's settings.

These headers reduce the frontend's attack surface. They do not certify the protocol, prevent all dependency/supply-chain compromise, or make the underlying financial contracts production-ready. Adding a real wallet, prover or API would require a separate review of both behavior and browser policy.

## Source checks

Before a release, run the tests and scan the exact Git index with a maintained secret scanner. Check the Vercel dry-run file list. Never publish `.env.local`, note secrets, operator private keys, trusted-setup intermediate secrets or witnesses. Keep `package-lock.json` pinned even though the static frontend build has no dependency installation.
