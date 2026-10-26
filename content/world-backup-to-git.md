A world folder holds months of prep: scenes, journals, actors, uploaded maps. A bad update, a broken module or one wrong click can ruin it, and Foundry keeps no history you can go back to.

World Backup to Git is a small service that runs next to your Foundry server and saves every world to its own **private GitHub repository** on a schedule. Each backup is a commit, so the full history of every world is kept, and any earlier state can be restored.

> **For self-hosted Foundry only.** The service is installed on the same machine as Foundry, so you need SSH (Linux) or RDP (Windows) access to that server to set it up. That rules out hosted services like The Forge, where you can't install anything on the server.

## What it does

- Backs up every world on a schedule, daily at 04:00 by default, or right away with **Back up now**.
- Gives each world its own private GitHub repository, created for you the first time it is backed up.
- Only makes a commit when something changed, so the history stays readable.
- Sends you an e-mail when a backup fails (GitHub refuses the token, a push is rejected, the folder can't be read), and another one when that world backs up fine again.
- Can keep itself up to date from its own releases.

## The administration page

A password-protected page on the server lists every world with whether it is backed up, when it was last backed up and how big its folder is. Each world has its own settings: on or off, the repository name, its own schedule and what to do while the world is running in Foundry. The page also holds the global schedule, the GitHub token, the e-mail settings and the admin password.

## Restoring a world

Stop the world, clone its repository into the worlds folder in place of the broken one, and start it again. To go back further than the latest backup, check out an older commit first. The service keeps backing the restored world up as before.

## Where it runs

- **Linux**, for example a Raspberry Pi, as a systemd service.
- **Windows**, as a scheduled task.

Both use one install script. It needs Node.js 18 or newer and downloads Node.js 22 if none is installed, plus `git` and a GitHub token that is allowed to create and push to private repositories.

## Status

Work in progress and not public yet. The source and the first public release will be published here when it is ready.
