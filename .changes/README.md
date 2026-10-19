# Release note fragments

Add one Markdown file per user-visible change. Do not edit `CHANGELOG.md` by hand for new entries.

- Name the file with a short unique kebab-case slug, for example `is-code-error-util.md`. Lowercase letters, digits, `.`, `_` and `-` only; other names are ignored by the release.
- Use a `## Changes` heading and English bullets:

```markdown
## Changes

- Add isCodeError util
```

- Commit the fragment on your feature branch. Only committed fragments are included in a release.
- Pure test or internal changes need no fragment.
- `npm run release` reads fragments from the release commit, adds them to the new `CHANGELOG.md` section, deletes the ones it included, and creates the `chore(release)` commit and tag. Fragments added after that point wait for the next release.
- The version and the commit-derived list still come from Conventional Commits through changelogen.
