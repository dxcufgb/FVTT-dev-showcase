Foundry installs a module from a public manifest link. When a module's releases live in a **private GitHub repository**, Foundry can't read them, because it has no way to sign in to GitHub. Private GitHub Proxy fills that gap: it holds a read-only GitHub token and hands Foundry the manifest and the module zip as if they were public.

**It works great for module development.** Keep the repository private while the module isn't ready for the public, and install real releases on your own Foundry server anyway, with updates showing up in Foundry like any other module's. When the module goes public, reinstall it from its public manifest link.

> **For self-hosted Foundry only.** The proxy is installed on the same machine as Foundry, so you need SSH (Linux) or RDP (Windows) access to that server to set it up. That rules out hosted services like The Forge, where you can't install anything on the server.

## How it works

1. You give the proxy a GitHub token that can only **read** the repositories you choose.
2. In Foundry you install the module from the proxy's manifest link, for example `http://localhost:8787/my-module/module.json`.
3. The proxy fetches the latest release from GitHub and gives Foundry the manifest and the zip, with the links inside pointing back at the proxy.
4. When you publish a new GitHub release, Foundry sees the update and installs it through the proxy, like any other module.

The token never leaves the server. Zips are streamed through without being unpacked, so it runs fine on a Raspberry Pi even for large modules.

## What it does

- Serves any number of private modules, each from its own repository.
- Installs the latest release or a specific version.
- Has a password-protected administration page to add, edit and remove modules and copy a module's link for Foundry.
- Sends you an e-mail when it has updated itself, and can keep itself up to date from its own releases.
- Works when Foundry runs in Docker, with its own manifest link for that case.

## Where it runs

- **Linux**, for example a Raspberry Pi, as a systemd service.
- **Windows**, as a scheduled task.

Both use one install script. It needs Node.js 18 or newer and downloads Node.js 22 if none is installed. Each private module needs a release workflow that attaches `module.zip` and `module.json` to its GitHub releases.

## Status

Work in progress and not public yet. The source and the first public release will be published here when it is ready.
