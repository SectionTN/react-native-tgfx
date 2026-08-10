import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = process.cwd();
const repoRoot = path.resolve(docsRoot, "..");
const pkg = path.join(repoRoot, "packages", "react-native-tgfx");

export default {
  name: "API Reference",
  entryPoints: [path.join(pkg, "src", "index.ts")],
  tsconfig: path.join(pkg, "tsconfig.json"),
  out: path.join(docsRoot, "content", "api"),
  plugin: [
    "typedoc-plugin-markdown",
    "typedoc-plugin-frontmatter",
    fileURLToPath(
      new URL("./scripts/typedoc-frontmatter.mts", import.meta.url)
    ),
  ],
  // Worklet-thread notes live in source doc comments, so typedoc has to keep the tag.
  blockTags: [
    "@param",
    "@returns",
    "@example",
    "@remarks",
    "@see",
    "@default",
    "@worklet",
    "@platform",
  ],
  readme: "none",
  fileExtension: ".mdx",
  entryFileName: "index",
  useCodeBlocks: true,
  expandParameters: true,
  hidePageHeader: true,
  hidePageTitle: true,
  hideBreadcrumbs: true,
  disableSources: true,
  excludePrivate: true,
  excludeProtected: true,
  excludeExternals: true,
  excludeInternal: true,
  skipErrorChecking: true,
  githubPages: false,
};
