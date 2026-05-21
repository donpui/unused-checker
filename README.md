# unused-checker

Small CLI for finding unused image assets in web app projects.

It scans source files like `js`, `jsx`, `ts`, `tsx`, `css`, and `html`, collects static references to image files, and reports any image assets that are never referenced.

## What it checks

- `svg`
- `png`
- `jpg`
- `jpeg`
- `gif`
- `webp`
- `avif`
- `bmp`
- `ico`

## Usage

```bash
node src/cli.js .
node src/cli.js ./my-app --delete
node src/cli.js ./my-app --json
```

## Install in another project

### Option 1: local path

From the project where you want to use it:

```bash
npm install --save-dev ../unused-checker
```

Then run it with:

```bash
npx unused-checker .
npx unused-checker . --delete
```

Or add a script in that project's `package.json`:

```json
{
  "scripts": {
    "check-unused-images": "unused-checker .",
    "check-unused-images:delete": "unused-checker . --delete"
  }
}
```

Then run:

```bash
npm run check-unused-images
npm run check-unused-images:delete
```

### Option 2: Git repo

If this tool is in GitHub or another Git server:

```bash
npm install --save-dev git+ssh://git@github.com/your-name/unused-checker.git
```

or:

```bash
npm install --save-dev github:your-name/unused-checker
```

### Option 3: publish to npm

This package is already structured as a CLI package because `package.json` has a `bin` entry:

```json
{
  "name": "unused-checker",
  "bin": {
    "unused-checker": "./src/cli.js"
  }
}
```

To publish it:

```bash
npm login
npm publish
```

Then in any other project:

```bash
npm install --save-dev unused-checker
npx unused-checker .
```

## Local CLI development

If you want to install it as a CLI globally on your machine while developing:

```bash
npm link
unused-checker ./my-app
unused-checker ./my-app --delete
```

## Notes

- The scanner is conservative. If it finds a static string that resolves to an existing image file, it treats that file as used.
- It supports relative imports, root-relative references like `"/logo.png"`, bare project-root paths like `"tests-pw/assets/file.png"`, `@/` imports, and basic `tsconfig.json` or `jsconfig.json` `baseUrl` and `paths` aliases.
- Ignored folders include `node_modules`, `.git`, `dist`, `build`, `.next`, `test-results`, `playwright-report`, and similar generated directories.
