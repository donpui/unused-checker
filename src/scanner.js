import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ASSET_EXTENSIONS,
  IGNORED_DIRECTORIES,
  SOURCE_EXTENSIONS
} from "./constants.js";

const ASSET_SUFFIX_PATTERN = [
  "svg",
  "png",
  "jpe?g",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico"
].join("|");

const STRING_LITERAL_REGEX = new RegExp(
  `(["'\`])([^"'\\n\`]*?\\.(${ASSET_SUFFIX_PATTERN})(?:\\?[^"'\\n\`]*)?)(\\1)`,
  "gi"
);

const CSS_URL_REGEX = new RegExp(
  `url\\(\\s*(['"]?)([^"'()\\s]+?\\.(${ASSET_SUFFIX_PATTERN})(?:\\?[^"'()\\s]*)?)\\1\\s*\\)`,
  "gi"
);

export async function scanProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const config = await loadProjectConfig(root);
  const sourceFiles = await collectFiles(root, SOURCE_EXTENSIONS);
  const assetFiles = await collectFiles(root, ASSET_EXTENSIONS);
  const assetSet = new Set(assetFiles);
  const referencedAssets = new Set();

  for (const sourceFile of sourceFiles) {
    const content = await fs.readFile(sourceFile, "utf8");
    const specifiers = extractAssetSpecifiers(content);

    for (const specifier of specifiers) {
      const resolvedAsset = resolveAssetSpecifier(
        specifier,
        sourceFile,
        root,
        assetSet,
        config
      );

      if (resolvedAsset) {
        referencedAssets.add(resolvedAsset);
      }
    }
  }

  const unusedFiles = assetFiles
    .filter((assetFile) => !referencedAssets.has(assetFile))
    .sort();

  const deletedFiles = [];

  if (options.delete) {
    for (const unusedFile of unusedFiles) {
      await fs.unlink(unusedFile);
      deletedFiles.push(unusedFile);
    }
  }

  return {
    projectRoot: root,
    sourceFilesCount: sourceFiles.length,
    assetFilesCount: assetFiles.length,
    referencedAssetsCount: referencedAssets.size,
    unusedFiles,
    deletedFiles
  };
}

function extractAssetSpecifiers(content) {
  const matches = new Set();

  STRING_LITERAL_REGEX.lastIndex = 0;

  for (const match of content.matchAll(STRING_LITERAL_REGEX)) {
    matches.add(match[2]);
  }

  CSS_URL_REGEX.lastIndex = 0;

  for (const match of content.matchAll(CSS_URL_REGEX)) {
    matches.add(match[2]);
  }

  return matches;
}

function resolveAssetSpecifier(
  specifier,
  sourceFile,
  projectRoot,
  assetSet,
  projectConfig
) {
  const cleanSpecifier = sanitizeSpecifier(specifier);

  if (!cleanSpecifier) {
    return null;
  }

  const candidates = [];

  if (cleanSpecifier.startsWith(".")) {
    candidates.push(path.resolve(path.dirname(sourceFile), cleanSpecifier));
  } else if (cleanSpecifier.startsWith("/")) {
    const relativeFromRoot = cleanSpecifier.replace(/^\/+/, "");
    candidates.push(path.resolve(projectRoot, "public", relativeFromRoot));
    candidates.push(path.resolve(projectRoot, relativeFromRoot));
    candidates.push(path.resolve(projectRoot, "src", relativeFromRoot));
  } else {
    candidates.push(path.resolve(projectRoot, cleanSpecifier));

    if (cleanSpecifier.startsWith("@/")) {
      candidates.push(path.resolve(projectRoot, "src", cleanSpecifier.slice(2)));
    }

    if (projectConfig.baseUrl) {
      candidates.push(path.resolve(projectConfig.baseUrl, cleanSpecifier));
    }

    for (const aliasTarget of resolveAliasTargets(cleanSpecifier, projectConfig)) {
      candidates.push(aliasTarget);
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = path.normalize(candidate);

    if (assetSet.has(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
}

function sanitizeSpecifier(specifier) {
  if (!specifier) {
    return null;
  }

  const trimmedSpecifier = specifier.trim();

  if (
    !trimmedSpecifier ||
    trimmedSpecifier.startsWith("http://") ||
    trimmedSpecifier.startsWith("https://") ||
    trimmedSpecifier.startsWith("data:") ||
    trimmedSpecifier.startsWith("#") ||
    trimmedSpecifier.startsWith("//")
  ) {
    return null;
  }

  try {
    return decodeURIComponent(trimmedSpecifier.split(/[?#]/, 1)[0]);
  } catch {
    return trimmedSpecifier.split(/[?#]/, 1)[0];
  }
}

async function collectFiles(root, allowedExtensions) {
  const files = [];
  const queue = [root];

  while (queue.length > 0) {
    const currentDirectory = queue.pop();
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(entryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

async function loadProjectConfig(projectRoot) {
  for (const configFileName of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(projectRoot, configFileName);

    try {
      const rawConfig = await fs.readFile(configPath, "utf8");
      const parsedConfig = parseJsonc(rawConfig);
      const compilerOptions = parsedConfig.compilerOptions ?? {};
      const baseUrl = compilerOptions.baseUrl
        ? path.resolve(projectRoot, compilerOptions.baseUrl)
        : null;

      return {
        baseUrl,
        aliases: normalizePathAliases(compilerOptions.paths ?? {}, baseUrl ?? projectRoot)
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {
    baseUrl: null,
    aliases: []
  };
}

function parseJsonc(rawConfig) {
  const withoutComments = stripJsonComments(rawConfig);
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

function stripJsonComments(rawConfig) {
  let output = "";
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < rawConfig.length) {
    const currentCharacter = rawConfig[index];
    const nextCharacter = rawConfig[index + 1];

    if (inString) {
      output += currentCharacter;

      if (escaped) {
        escaped = false;
      } else if (currentCharacter === "\\") {
        escaped = true;
      } else if (currentCharacter === "\"") {
        inString = false;
      }

      index += 1;
      continue;
    }

    if (currentCharacter === "\"") {
      inString = true;
      output += currentCharacter;
      index += 1;
      continue;
    }

    if (currentCharacter === "/" && nextCharacter === "/") {
      index += 2;

      while (index < rawConfig.length && rawConfig[index] !== "\n") {
        index += 1;
      }

      continue;
    }

    if (currentCharacter === "/" && nextCharacter === "*") {
      index += 2;

      while (
        index < rawConfig.length &&
        !(rawConfig[index] === "*" && rawConfig[index + 1] === "/")
      ) {
        index += 1;
      }

      index += 2;
      continue;
    }

    output += currentCharacter;
    index += 1;
  }

  return output;
}

function normalizePathAliases(pathsConfig, baseDirectory) {
  return Object.entries(pathsConfig).flatMap(([aliasPattern, targets]) => {
    const targetList = Array.isArray(targets) ? targets : [targets];

    return targetList.map((targetPattern) => ({
      aliasPattern,
      targetPattern,
      baseDirectory
    }));
  });
}

function resolveAliasTargets(specifier, projectConfig) {
  const targets = [];

  for (const alias of projectConfig.aliases) {
    const wildcardValue = extractWildcardValue(alias.aliasPattern, specifier);

    if (wildcardValue === null) {
      continue;
    }

    const targetPath = alias.targetPattern.includes("*")
      ? alias.targetPattern.replace("*", wildcardValue)
      : alias.targetPattern;

    targets.push(path.resolve(alias.baseDirectory, targetPath));
  }

  return targets;
}

function extractWildcardValue(pattern, value) {
  if (!pattern.includes("*")) {
    return value === pattern ? "" : null;
  }

  const [prefix, suffix] = pattern.split("*");

  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return null;
  }

  return value.slice(prefix.length, value.length - suffix.length);
}
