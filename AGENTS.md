# AGENTS.md

## Commits

- Use Conventional Commits: `type(scope): subject`
- Scope is **required**; always name the affected area, e.g. `feat(tool): ...`, `fix(client): ...`
- Types: `feat`, `fix`, `chore`, `docs`, `ci`, `test`, `refactor`, `perf`, `style`
- One logical change per commit; don't bulk unrelated changes
- Don't commit until validation complete (tests pass: `bun test`)

## Release tags

- Never run plain `git tag <ver>`: `tag.gpgsign=true` triggers a sign prompt and aborts non-interactive shells
- Always create lightweight unsigned tags: `git -c tag.gpgsign=false tag <ver>`
- Before pushing a tag, verify type is `commit` (`git cat-file -t <ver>`) and tag matches package version (`v$(node -p "require('./package.json').version")`)
- Pushing a `v*` tag triggers npm publish via CI; no undo, so verify first
- Tag push also auto-creates the GitHub Release (workflow `release` job, runs after publish)
