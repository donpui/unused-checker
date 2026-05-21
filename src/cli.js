#!/usr/bin/env node

import path from "node:path";
import { scanProject } from "./scanner.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("-")));
const positionalArgs = args.filter((arg) => !arg.startsWith("-"));
const knownFlags = new Set(["--help", "-h", "--delete", "--json"]);

if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

const unknownFlags = [...flags].filter((flag) => !knownFlags.has(flag));

if (unknownFlags.length > 0) {
  console.error(`Unknown option: ${unknownFlags.join(", ")}`);
  printHelp();
  process.exit(1);
}

if (positionalArgs.length > 1) {
  console.error("Expected at most one project path.");
  printHelp();
  process.exit(1);
}

const projectPath = positionalArgs[0] ?? ".";
const shouldDelete = flags.has("--delete");
const outputJson = flags.has("--json");

try {
  const report = await scanProject(projectPath, { delete: shouldDelete });

  if (outputJson) {
    console.log(
      JSON.stringify(
        {
          ...report,
          unusedFiles: report.unusedFiles.map((file) =>
            path.relative(report.projectRoot, file)
          ),
          deletedFiles: report.deletedFiles.map((file) =>
            path.relative(report.projectRoot, file)
          )
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  console.log(
    `Scanned ${report.sourceFilesCount} source files and ${report.assetFilesCount} image assets in ${report.projectRoot}`
  );

  if (report.unusedFiles.length === 0) {
    console.log("No unused image assets found.");
    process.exit(0);
  }

  const listedFiles = shouldDelete ? report.deletedFiles : report.unusedFiles;
  const verb = shouldDelete ? "Deleted" : "Unused";

  console.log(`${verb} ${listedFiles.length} file${listedFiles.length === 1 ? "" : "s"}:`);

  for (const file of listedFiles) {
    console.log(`- ${path.relative(report.projectRoot, file)}`);
  }

  if (!shouldDelete) {
    console.log("Run again with --delete to remove these files.");
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function printHelp() {
  console.log(`unused-checker [project-path] [--delete] [--json]

Find unused image files referenced from JS, TS, React, CSS, and HTML source files.

Options:
  --delete   Remove files reported as unused
  --json     Print the result as JSON
  --help     Show this help message`);
}
