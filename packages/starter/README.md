# @culmjs/starter

A starter plug-in for Culm: one look, named site styles and eight general blocks, written only against the public names of `@culmjs/core`. It also holds the bakery site that `culm init` copies (`template/`).

| Block            | Looks                       | What it is                                                                                                      |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `page-header`    | `bar`, `centered`           | The site name, the navigation and an optional button; the navigation is required in every look                  |
| `page-footer`    | `simple`, `columns`         | A note and optional links                                                                                       |
| `hero`           | `plain`, `image`            | The page title (a required `h1`), a lead line and a button, with an optional image                              |
| `text-section`   | `narrow`, `wide`            | A heading and text in a column of 640 or 960 px                                                                 |
| `image-text`     | `image-left`, `image-right` | An image beside a heading and text                                                                              |
| `card-grid`      | `cards`, `rows`             | A heading and one card or row for each row of a source (default source `menu`); with no rows, the heading alone |
| `link-list`      | `plain`, `boxed`            | A heading and one link for each row of a source (default source `links`); with no rows, the heading alone       |
| `call-to-action` | `band`, `card`              | A heading and a button                                                                                          |

Tokens: colours `ink #1c1917`, `canvas #fafaf9`, `brand #b45309`, `muted #57534e`, `line #e7e5e4`; text styles `eyebrow` 11, `body` 17, `lead` 20, `h3` 24, `h2` 32, `h1` 48 (a text range of 11 to 96); spacing `xs` 4, `s` 8, `m` 16, `l` 24, `xl` 40, `2xl` 64. Fonts are the system stacks only; the package ships no font file. Every heading and the navigation are required content.

To begin a site (4-page bakery starter by default, or pass `--blank` for a minimal single-page site):

```sh
npx @culmjs/tools init my-site
cd my-site
npm install
npx culm dev
npx culm build
```

Nothing is on npm yet, so until a release the steps above do not work. From a checkout of this repository, run `npm run pack:all` (it writes three tarballs to `.pack/`), then `node packages/tools/bin/culm.js init my-site --from .pack`, then `npm install` in `my-site`. `--from <folder>` is a folder that holds `culmjs-core-*.tgz`, `culmjs-starter-*.tgz` and `culmjs-tools-*.tgz`; `init` then writes `file:` dependencies on them in place of version numbers. A relative `--from` is resolved against the folder you run the command in.
