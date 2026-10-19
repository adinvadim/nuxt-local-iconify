import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  changelogenCliPath,
  consumeFragments,
  resolveGithubProvider,
  insertIntoRelease,
  listFragments,
  parseFragment,
  renderFragmentBlock,
  runRelease,
} from "../scripts/changelog-release.mjs";

const changelogenCli = changelogenCliPath(
  join(dirname(fileURLToPath(import.meta.url)), ".."),
);

Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
});

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function writeIn(cwd: string, path: string, content: string) {
  mkdirSync(join(cwd, dirname(path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

function commitFile(cwd: string, path: string, content: string, message: string) {
  writeIn(cwd, path, content);
  git(cwd, "add", "--", path);
  git(cwd, "commit", "-q", "-m", message);
}

// A real repo with a historical changelog entry and tag v1.0.0.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "release-changelog-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  writeIn(dir, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2) + "\n");
  writeIn(
    dir,
    "CHANGELOG.md",
    "# Changelog\n\n\n## v1.0.0\n\n### 🚀 Enhancements\n\n- Initial release\n",
  );
  writeIn(dir, "src/index.ts", "export {}\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "feat: initial");
  git(dir, "tag", "v1.0.0");
  return dir;
}

describe("parseFragment", () => {
  it("reads several headings and trims blank edges", () => {
    const sections = parseFragment(
      "a.md",
      "\n## Changes\n\n- One\n- Two\n\n## Notes\n\n- Three\n",
    );
    expect([...sections.keys()]).toEqual(["Changes", "Notes"]);
    expect(sections.get("Changes")).toEqual(["- One", "- Two"]);
  });

  it("accepts CRLF line endings", () => {
    const sections = parseFragment("a.md", "## Changes\r\n\r\n- One\r\n");
    expect(sections.get("Changes")).toEqual(["- One"]);
  });

  it("rejects headings that changelogen would read as release boundaries", () => {
    expect(() => parseFragment("a.md", "## Changes for Node 22.0.0\n\n- X\n")).toThrow(
      /version number/,
    );
  });

  it("rejects content before a heading, other headings, and empty sections", () => {
    expect(() => parseFragment("a.md", "- loose\n")).toThrow(/before the first/);
    expect(() => parseFragment("a.md", "## Changes\n\n### Nope\n")).toThrow(/only "## "/);
    expect(() => parseFragment("a.md", "## Changes\n\n")).toThrow(/empty/);
    expect(() => parseFragment("a.md", "")).toThrow(/no "## " section/);
  });
});

describe("listFragments", () => {
  it("reads only the frozen commit and skips README and non-markdown files", () => {
    const dir = makeRepo();
    commitFile(dir, ".changes/add-x.md", "## Changes\n\n- Add x\n", "docs: add x note");
    commitFile(dir, ".changes/README.md", "# Rules\n", "docs: rules");
    commitFile(dir, ".changes/notes.txt", "ignored\n", "docs: text");
    const frozen = git(dir, "rev-parse", "HEAD").trim();

    commitFile(dir, ".changes/added-later.md", "## Changes\n\n- Later\n", "docs: later");
    writeIn(dir, ".changes/uncommitted.md", "## Changes\n\n- Uncommitted\n");

    const names = listFragments(dir, frozen).map((fragment) => fragment.name);
    expect(names).toEqual(["add-x.md"]);
  });
});

describe("rendering and insertion", () => {
  it("renders grouped fragments in name order", () => {
    const block = renderFragmentBlock([
      { name: "b.md", sections: new Map([["Changes", ["- Second"]]]) },
      { name: "a.md", sections: new Map([["Changes", ["- First"]]]) },
    ]);
    expect(block).toEqual(["### Changes", "", "- First", "- Second", ""]);
  });

  it("separates non-bullet paragraphs from the next fragment", () => {
    const block = renderFragmentBlock([
      { name: "a.md", sections: new Map([["Changes", ["Intro paragraph."]]]) },
      { name: "b.md", sections: new Map([["Changes", ["- Second"]]]) },
    ]);
    expect(block).toEqual(["### Changes", "", "Intro paragraph.", "", "- Second", ""]);
  });

  it("inserts before commit-derived groups in the matching release only", () => {
    const changelog =
      "# Changelog\n\n\n## v1.1.0\n\n[compare](x)\n\n### 🚀 Enhancements\n\n- Derived\n\n\n## v1.0.0\n\n### 🚀 Enhancements\n\n- Initial\n";
    const block = renderFragmentBlock([
      { name: "a.md", sections: new Map([["Changes", ["- Hand written"]]]) },
    ]);
    const result = insertIntoRelease(changelog, "1.1.0", block);
    expect(result).toBe(
      "# Changelog\n\n\n## v1.1.0\n\n[compare](x)\n\n### Changes\n\n- Hand written\n\n### 🚀 Enhancements\n\n- Derived\n\n\n## v1.0.0\n\n### 🚀 Enhancements\n\n- Initial\n",
    );
  });

  it("appends a group when the release section has none", () => {
    const changelog = "# Changelog\n\n\n## v1.1.0\n\n\n## v1.0.0\n\n- Initial\n";
    const result = insertIntoRelease(changelog, "1.1.0", ["### Changes", "", "- Hand", ""]);
    expect(result).toBe(
      "# Changelog\n\n\n## v1.1.0\n\n### Changes\n\n- Hand\n\n\n## v1.0.0\n\n- Initial\n",
    );
  });
});

describe("consumeFragments", () => {
  it("deletes unchanged frozen fragments and keeps edited ones", () => {
    const dir = makeRepo();
    commitFile(dir, ".changes/a.md", "## Changes\n\n- A\n", "docs: a");
    commitFile(dir, ".changes/b.md", "## Changes\n\n- B\n", "docs: b");
    const frozen = git(dir, "rev-parse", "HEAD").trim();
    const fragments = listFragments(dir, frozen);

    writeIn(dir, ".changes/b.md", "## Changes\n\n- B edited after freeze\n");
    const result = consumeFragments(dir, fragments);

    expect(result).toEqual({ consumed: ["a.md"], kept: ["b.md"] });
    expect(existsSync(join(dir, ".changes/a.md"))).toBe(false);
    expect(readFileSync(join(dir, ".changes/b.md"), "utf8")).toContain("edited after freeze");
  });
});

describe("runRelease", () => {
  it(
    "assembles committed fragments into the release commit and keeps uncommitted ones",
    () => {
      const dir = makeRepo();
      const historical = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
      commitFile(dir, "src/feature.ts", "export const x = 1\n", "feat: add feature x");
      commitFile(dir, ".changes/add-feature-x.md", "## Changes\n\n- Add feature x\n", "docs(changes): add feature x");
      writeIn(dir, ".changes/later.md", "## Changes\n\n- Not frozen\n");

      const result = runRelease({ cwd: dir, changelogenCli, github: false });

      expect(result).toEqual({
        version: "1.1.0",
        resumed: false,
        fragments: ["add-feature-x.md"],
        consumed: ["add-feature-x.md"],
        kept: [],
      });
      const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
      expect(changelog.match(/^## v1\.1\.0$/gm)).toHaveLength(1);
      expect(changelog).toContain("### Changes\n\n- Add feature x\n");
      expect(changelog.endsWith(historical.slice(historical.indexOf("## v1.0.0")))).toBe(true);
      expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("chore(release): v1.1.0");
      expect(git(dir, "tag", "--points-at", "HEAD")).toContain("v1.1.0");
      expect(git(dir, "show", "--name-status", "--format=", "HEAD")).toContain(
        "D\t.changes/add-feature-x.md",
      );
      expect(existsSync(join(dir, ".changes/later.md"))).toBe(true);
      expect(git(dir, "status", "--porcelain", "--untracked-files=all")).toContain("?? .changes/later.md");
    },
    60_000,
  );

  it(
    "leaves the changelog to commit-derived notes when there are no fragments",
    () => {
      const dir = makeRepo();
      commitFile(dir, "src/feature.ts", "export const x = 1\n", "feat: add feature x");

      const result = runRelease({ cwd: dir, changelogenCli, github: false });

      expect(result.fragments).toEqual([]);
      const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
      expect(changelog).not.toContain("### Changes");
      expect(changelog).toContain("Add feature x");
    },
    60_000,
  );

  it(
    "refuses to run with tracked changes",
    () => {
      const dir = makeRepo();
      writeIn(dir, "CHANGELOG.md", "# Changelog\n\nedited\n");
      expect(() => runRelease({ cwd: dir, changelogenCli, github: false })).toThrow(
        /Tracked changes present/,
      );
    },
    60_000,
  );

  it(
    "resumes after an interrupted run by tagging the existing release commit only",
    () => {
      const dir = makeRepo();
      commitFile(dir, "src/feature.ts", "export const x = 1\n", "feat: add feature x");
      commitFile(dir, ".changes/add-x.md", "## Changes\n\n- Add x\n", "docs: add x");
      runRelease({ cwd: dir, changelogenCli, github: false });
      const commitsBefore = git(dir, "rev-list", "--count", "HEAD").trim();
      git(dir, "tag", "-d", "v1.1.0");

      const result = runRelease({ cwd: dir, changelogenCli, github: false });

      expect(result).toEqual({ version: "1.1.0", resumed: true, fragments: [], consumed: [], kept: [] });
      expect(git(dir, "rev-list", "--count", "HEAD").trim()).toBe(commitsBefore);
      expect(git(dir, "tag", "--list", "v1.1.0").trim()).toBe("v1.1.0");
      const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
      expect(changelog.match(/^## v1\.1\.0$/gm)).toHaveLength(1);
      expect(changelog.match(/### Changes\n\n- Add x\n/g)).toHaveLength(1);
    },
    60_000,
  );

  it(
    "resumes the exact release commit when its tag already exists",
    () => {
      const dir = makeRepo();
      commitFile(dir, "src/feature.ts", "export const x = 1\n", "feat: add feature x");
      runRelease({ cwd: dir, changelogenCli, github: false });
      const head = git(dir, "rev-parse", "HEAD").trim();
      const commitsBefore = git(dir, "rev-list", "--count", "HEAD").trim();

      const result = runRelease({ cwd: dir, changelogenCli, github: false });

      expect(result).toEqual({ version: "1.1.0", resumed: true, fragments: [], consumed: [], kept: [] });
      expect(git(dir, "rev-list", "--count", "HEAD").trim()).toBe(commitsBefore);
      expect(git(dir, "rev-parse", "refs/tags/v1.1.0^{commit}").trim()).toBe(head);
    },
    60_000,
  );

  it(
    "retries GitHub sync after a failure that happens after tagging",
    () => {
      const dir = makeRepo();
      const fakeGh = writeFakeGh();
      process.env.FAKE_GH_STATE = join(scratchDir(), "gh-calls.log");
      writeFileSync(`${process.env.FAKE_GH_STATE}.fail`, "");
      commitFile(dir, "src/feature.ts", "export const x = 1\n", "feat: add feature x");

      expect(() => runRelease({ cwd: dir, changelogenCli, githubCli: fakeGh })).toThrow(
        /release v1\.1\.0 failed/,
      );
      expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("chore(release): v1.1.0");
      expect(git(dir, "rev-parse", "refs/tags/v1.1.0^{commit}").trim()).toBe(
        git(dir, "rev-parse", "HEAD").trim(),
      );
      const commitsAfterFailure = git(dir, "rev-list", "--count", "HEAD").trim();

      const result = runRelease({ cwd: dir, changelogenCli, githubCli: fakeGh });

      expect(result).toMatchObject({ version: "1.1.0", resumed: true });
      expect(git(dir, "rev-list", "--count", "HEAD").trim()).toBe(commitsAfterFailure);
      expect(readFileSync(process.env.FAKE_GH_STATE, "utf8").trim().split("\n")).toEqual([
        "release v1.1.0",
        "release v1.1.0",
      ]);
    },
    60_000,
  );

  it("resolves GitHub from package.json even when origin is an SSH host alias", () => {
    const dir = makeRepo();
    writeIn(
      dir,
      "package.json",
      JSON.stringify({ name: "fixture", version: "1.0.0", repository: "https://github.com/adinvadim/tiny-code-error" }, null, 2) + "\n",
    );
    git(dir, "remote", "add", "origin", "git@github-work:adinvadim/tiny-code-error.git");

    expect(resolveGithubProvider(dir, changelogenCli)).toBe("github");
  });

  it(
    "refuses to resume when the release tag points at another commit",
    () => {
      const dir = makeRepo();
      commitFile(dir, "src/feature.ts", "export const x = 1\n", "feat: add feature x");
      runRelease({ cwd: dir, changelogenCli, github: false });
      git(dir, "tag", "-f", "v1.1.0", "HEAD~1");

      expect(() => runRelease({ cwd: dir, changelogenCli, github: false })).toThrow(
        /does not point to HEAD/,
      );
    },
    60_000,
  );
});

function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "release-gh-"));
  dirs.push(dir);
  return dir;
}

// Stands in for `changelogen gh release`: logs each call and fails once when marked.
function writeFakeGh() {
  const path = join(scratchDir(), "fake-gh.mjs");
  writeFileSync(
    path,
    [
      'import { appendFileSync, existsSync, rmSync } from "node:fs";',
      "const state = process.env.FAKE_GH_STATE;",
      'appendFileSync(state, process.argv.slice(2).join(" ") + "\\n");',
      "if (existsSync(state + \".fail\")) { rmSync(state + \".fail\"); process.exit(1); }",
      "",
    ].join("\n"),
  );
  return path;
}
