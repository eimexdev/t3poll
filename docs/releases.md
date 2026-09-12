# npm releases

`t3poll` publishes prereleases under `nightly`. Stable releases use `latest` and are always started manually. The default `publishConfig.tag` is `nightly` to keep an accidental bare publish from advancing stable.

## GitHub setup

The workflow is `.github/workflows/release.yml`. Enable it with repository variable `NPM_PUBLISH_ENABLED=true` after configuring npm trusted publishing for:

- Repository owner: `eimexdev`
- Repository: `t3poll`
- Workflow filename: `release.yml`
- Environment: leave blank
- Permission: allow direct publishing

No npm token is stored in GitHub. The publish job uses `id-token: write`, hosted runners, Node 24, and npm's OIDC support. GitHub's built-in token records a release and source tag after npm publication. Repository workflows must be allowed to run.

## Automatic nightlies

Pushes to `master` trigger the release workflow. It resolves the current branch head after entering the release queue, skips commits already published on nightly, and builds a timestamped version such as `0.1.0-nightly.20260912030405`.

Linux, macOS, and Windows must pass tests, type checks, and installation from a production tarball before publication. The Linux tarball is retained as a workflow artifact and published directly without rebuilding. Its manifest includes `t3pollRelease.commit` and `t3pollRelease.channel`. A GitHub prerelease uses the same version and source commit.

To retry deliberately or test publishing without another commit:

```sh
gh workflow run release.yml --ref master -f channel=nightly
```

All channels share one release concurrency group, and running releases are never cancelled. A queued automatic release picks up the current master commit instead of moving the npm tag back to an older queued push.

## Manual stable releases

Complete worker update/handoff testing before the first stable release. Until then, install with `npx t3poll@nightly setup`.

```sh
gh workflow run release.yml --ref master -f channel=latest -f version=0.1.0
```

The workflow resolves the source commit recorded in the published nightly package, verifies that commit belongs to master, builds a stable version from it, and repeats the platform and package checks. It does not move the nightly prerelease itself to `latest`: the stable package version is needed so setup inherits the stable channel. The requested stable version must advance the current `latest` version. Omit `version` to use that commit's package.json base version.

If a future stable line needs a new base version for nightlies, update package.json and package-lock.json together on master.

## First publication

npm trusted publishing requires an existing package. The first release uses an authenticated maintainer's local npm session and a clean checkout of the tested source commit. Stamp a nightly version into the disposable checkout, build and test it, pack it, verify the installed tarball, and publish with `--tag nightly --access public`. Configure the trust relationship afterward, enable the repository variable, then exercise the workflow. npm may require browser or two-factor verification for these account actions.

Keep the main checkout's version at its stable base. Release stamping changes only the disposable build's package manifests. Do not put an npm token in the repository or workflow.

## Recovery and limitations

A published npm version is immutable. If publication succeeds but the GitHub release step fails, the npm package remains available; create its GitHub release from the recorded source commit and retained artifact rather than republishing that version. Check the npm registry before retrying a publication after a network timeout.

The installer resolves the npm channel when its MCP process starts. Running MCP processes and workers keep their loaded code. Automatic worker handoff is separate work; publishing a newer package does not upgrade an already running worker. The installer checks the package online at startup and has no explicit failed-download fallback.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [npm trust CLI](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [distribution tags](https://docs.npmjs.com/adding-dist-tags-to-packages/).
