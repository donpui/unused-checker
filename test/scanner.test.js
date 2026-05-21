import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanProject } from "../src/scanner.js";

test("finds unused assets across JS, TSX, CSS and public paths", async () => {
  const projectRoot = await createProject({
    "src/App.tsx": `
      import logo from "./assets/logo.svg";
      import hero from "@/assets/hero.png";
      const publicImage = "/banner.jpg";
      const localImage = new URL("./assets/card-bg.png", import.meta.url);
      console.log(logo, hero, publicImage, localImage);
    `,
    "src/styles.css": `
      .card {
        background-image: url("./assets/pattern.png");
      }
    `,
    "tsconfig.json": `
      {
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@/*": ["src/*"]
          }
        }
      }
    `,
    "src/assets/logo.svg": "<svg></svg>",
    "src/assets/hero.png": "hero",
    "src/assets/card-bg.png": "card",
    "src/assets/pattern.png": "pattern",
    "src/assets/unused.jpg": "unused",
    "public/banner.jpg": "banner"
  });

  const report = await scanProject(projectRoot);
  const unusedFiles = report.unusedFiles.map((file) => path.relative(projectRoot, file));

  assert.deepEqual(unusedFiles, ["src/assets/unused.jpg"]);
});

test("supports baseUrl imports without explicit path aliases", async () => {
  const projectRoot = await createProject({
    "jsconfig.json": `
      {
        "compilerOptions": {
          "baseUrl": "src"
        }
      }
    `,
    "src/index.js": `
      const icon = "images/used.png";
      console.log(icon);
    `,
    "src/images/used.png": "used",
    "src/images/leftover.png": "leftover"
  });

  const report = await scanProject(projectRoot);
  const unusedFiles = report.unusedFiles.map((file) => path.relative(projectRoot, file));

  assert.deepEqual(unusedFiles, ["src/images/leftover.png"]);
});

test("treats bare project-root asset paths as used", async () => {
  const projectRoot = await createProject({
    "src/constants.js": `
      export const WEB_FILE = "tests-pw/assets/analysis1.png";
      export const MOBILE_FILE = "tests-pw/assets/mobile.jpg";
    `,
    "tests-pw/assets/analysis1.png": "analysis",
    "tests-pw/assets/mobile.jpg": "mobile",
    "tests-pw/assets/unused.jpg": "unused"
  });

  const report = await scanProject(projectRoot);
  const unusedFiles = report.unusedFiles.map((file) => path.relative(projectRoot, file));

  assert.deepEqual(unusedFiles, ["tests-pw/assets/unused.jpg"]);
});

test("ignores generated test artifact directories", async () => {
  const projectRoot = await createProject({
    "test-results/failed.png": "failed",
    "playwright-report/report-image.png": "report"
  });

  const report = await scanProject(projectRoot);

  assert.equal(report.assetFilesCount, 0);
  assert.deepEqual(report.unusedFiles, []);
});

test("deletes only unused assets when delete mode is enabled", async () => {
  const projectRoot = await createProject({
    "src/index.jsx": `
      import icon from "./images/used.png";
      console.log(icon);
    `,
    "src/images/used.png": "used",
    "src/images/remove-me.png": "remove"
  });

  const report = await scanProject(projectRoot, { delete: true });
  const deletedFiles = report.deletedFiles.map((file) => path.relative(projectRoot, file));

  assert.deepEqual(deletedFiles, ["src/images/remove-me.png"]);
  await assert.rejects(fs.access(path.join(projectRoot, "src/images/remove-me.png")));
  await fs.access(path.join(projectRoot, "src/images/used.png"));
});

async function createProject(files) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "unused-checker-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(projectRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }

  return projectRoot;
}
