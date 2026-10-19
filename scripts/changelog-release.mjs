// Release wrapper around changelogen. changelogen still computes the version
// and commit-derived markdown; this script adds committed `.changes/*.md`
// fragments to the new release section and makes the release commit and tag.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FRAGMENT_DIR = ".changes";
const FRAGMENT_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.md$/;
const SECTION_RE = /^## (\S.*)$/;

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

// A fragment is one or more `## <Heading>` sections with bullet content.
// Anything else is rejected so a malformed note cannot vanish silently.
export function parseFragment(name, text) {
  const sections = new Map();
  let heading = null;
  for (const line of text.split("\n")) {
    const match = line.match(SECTION_RE);
    if (match) {
      heading = match[1].trim();
      if (!sections.has(heading)) sections.set(heading, []);
      continue;
    }
    if (line.startsWith("#")) {
      throw new Error(`${name}: only "## " headings are allowed`);
    }
    if (heading === null) {
      if (line.trim() !== "") {
        throw new Error(`${name}: content before the first "## " heading`);
      }
      continue;
    }
    sections.get(heading).push(line);
  }
  if (sections.size === 0) throw new Error(`${name}: no "## " section`);
  for (const [key, lines] of sections) {
    const body = trimBlankEdges(lines);
    if (body.length === 0) throw new Error(`${name}: empty "## ${key}" section`);
    sections.set(key, body);
  }
  return sections;
}

// Reads fragments from a Git commit, never from the working tree, so newer or
// uncommitted notes cannot leak into the release being cut.
export function listFragments(cwd, ref) {
  const listing = git(cwd, ["ls-tree", "-r", "-z", ref, "--", FRAGMENT_DIR]);
  const fragments = [];
  for (const record of listing.split("\0")) {
    if (!record) continue;
    const match = record.match(/^\d+ (\w+) ([0-9a-f]+)\t(.+)$/);
    if (!match) continue;
    const [, type, blob, path] = match;
    const name = path.slice(FRAGMENT_DIR.length + 1);
    if (type !== "blob" || name.includes("/")) continue;
    if (!FRAGMENT_NAME_RE.test(name)) continue;
    const text = git(cwd, ["cat-file", "blob", blob]);
    fragments.push({ name, path, blob, sections: parseFragment(name, text) });
  }
  return fragments.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Groups bullets by heading in fragment-name order and returns release lines.
export function renderFragmentBlock(fragments) {
  const groups = new Map();
  const ordered = [...fragments].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const fragment of ordered) {
    for (const [heading, lines] of fragment.sections) {
      if (!groups.has(heading)) groups.set(heading, []);
      const bodies = groups.get(heading);
      const previous = bodies[bodies.length - 1];
      const bulletJoin = /^[-*] /.test(previous ?? "") && /^[-*] /.test(lines[0]);
      if (bodies.length > 0 && !bulletJoin) bodies.push("");
      bodies.push(...lines);
    }
  }
  const out = [];
  for (const [heading, bodies] of groups) {
    out.push(`### ${heading}`, "", ...bodies, "");
  }
  return out;
}

// Puts fragment groups before commit-derived groups, or at the end of the
// release section when changelogen produced none.
export function insertIntoRelease(changelog, version, blockLines) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line === `## v${version}`);
  if (start === -1) throw new Error(`CHANGELOG.md has no "## v${version}" section`);
  let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  if (end === -1) end = lines.length;
  const groupAt = lines.findIndex(
    (line, i) => i > start && i < end && line.startsWith("### "),
  );
  const body = trimBlankEdges(blockLines);
  if (groupAt !== -1) {
    lines.splice(groupAt, 0, ...body, "");
  } else {
    let at = end;
    while (at - 1 > start && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, "", ...body);
  }
  return lines.join("\n");
}

// Deletes only fragments whose working-tree bytes still match the frozen blob.
// Edited or newly arrived fragments stay in place for the next release.
export function consumeFragments(cwd, fragments) {
  const consumed = [];
  const kept = [];
  for (const fragment of fragments) {
    if (!existsSync(join(cwd, fragment.path))) {
      kept.push(fragment.name);
      continue;
    }
    const current = git(cwd, ["hash-object", "--", fragment.path]).trim();
    if (current !== fragment.blob) {
      kept.push(fragment.name);
      continue;
    }
    git(cwd, ["rm", "-q", "--", fragment.path]);
    consumed.push(fragment.name);
  }
  return { consumed, kept };
}

// Launches changelogen's JS entry with the current Node binary. Spawning the
// node_modules/.bin shim directly fails on Windows, where it is a .cmd file.
export function changelogenCliPath(root) {
  const manifest = readJson(join(root, "node_modules", "changelogen", "package.json"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.changelogen;
  return join(root, "node_modules", "changelogen", bin);
}

function runNode(entry, cwd, args) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${entry.split(/[\\/]/).pop()} ${args.join(" ")} failed (${result.status ?? result.signal})`,
    );
  }
}

// Creates the tag on HEAD, or accepts an existing tag only if it already points there.
function ensureTag(cwd, tag) {
  const head = git(cwd, ["rev-parse", "HEAD"]).trim();
  const target = tryGit(cwd, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`])?.trim();
  if (target === undefined) {
    git(cwd, ["tag", "-am", tag, tag]);
  } else if (target !== head) {
    throw new Error(`${tag} does not point to HEAD (${target} != ${head})`);
  }
}

// GitHub sync is idempotent: `changelogen gh release` updates an existing release.
// githubCli replaces the default boundary so tests never reach GitHub.
function syncGithubRelease({ cwd, changelogenCli, githubCli, tag, github }) {
  if (!github) return;
  if (githubCli !== undefined) {
    runNode(githubCli, cwd, ["release", tag]);
    return;
  }
  if (resolveGithubProvider(cwd, changelogenCli) === "github") {
    runNode(changelogenCli, cwd, ["gh", "release", tag]);
  }
}

// Asks changelogen's own repo resolution (package.json first, then origin), so SSH host
// aliases behave as they do in its release path. An origin-URL regex would diverge from it.
export function resolveGithubProvider(cwd, changelogenCli) {
  const index = pathToFileURL(join(dirname(changelogenCli), "index.mjs")).href;
  const probe = [
    `const { resolveRepoConfig } = await import(process.argv[1]);`,
    "const repo = await resolveRepoConfig(process.cwd());",
    'process.stdout.write(repo?.provider ?? "");',
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe, index], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error("could not resolve the repository provider");
  return result.stdout.trim();
}

/**
 * @param {{ cwd: string, changelogenCli: string, github?: boolean, githubCli?: string }} options
 */
export function runRelease({ cwd, changelogenCli, github = true, githubCli }) {
  if (git(cwd, ["status", "--porcelain", "--untracked-files=no"]).trim()) {
    throw new Error("Tracked changes present; commit or discard them before releasing.");
  }
  const pkgPath = join(cwd, "package.json");
  const current = readJson(pkgPath).version;
  const tag = `v${current}`;
  const headSubject = git(cwd, ["log", "-1", "--format=%s"]).trim();

  // HEAD is already the release commit: finish tagging and GitHub sync, never bump again.
  if (headSubject === `chore(release): ${tag}`) {
    ensureTag(cwd, tag);
    syncGithubRelease({ cwd, changelogenCli, githubCli, tag, github });
    return { version: current, resumed: true, fragments: [], consumed: [], kept: [] };
  }

  const frozen = git(cwd, ["rev-parse", "HEAD"]).trim();
  const fragments = listFragments(cwd, frozen);

  runNode(changelogenCli, cwd, ["--release", "--no-commit", "--no-tag", "--no-github"]);
  const version = readJson(pkgPath).version;
  if (version === current) throw new Error("changelogen did not bump the version");

  if (fragments.length > 0) {
    const changelogPath = join(cwd, "CHANGELOG.md");
    const block = renderFragmentBlock(fragments);
    writeFileSync(
      changelogPath,
      insertIntoRelease(readFileSync(changelogPath, "utf8"), version, block),
    );
  }

  const { consumed, kept } = consumeFragments(cwd, fragments);
  git(cwd, ["add", "--", "CHANGELOG.md", "package.json"]);
  git(cwd, ["commit", "-m", `chore(release): v${version}`]);
  ensureTag(cwd, `v${version}`);
  syncGithubRelease({ cwd, changelogenCli, githubCli, tag: `v${version}`, github });
  return {
    version,
    resumed: false,
    fragments: fragments.map((fragment) => fragment.name),
    consumed,
    kept,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = runRelease({
    cwd: process.cwd(),
    changelogenCli: changelogenCliPath(join(here, "..")),
    github: !process.argv.includes("--no-github"),
  });
  console.log(JSON.stringify(result));
}
