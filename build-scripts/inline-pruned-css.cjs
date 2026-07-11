#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const csso = require("csso");
const { minify: minifyHtml } = require("html-minifier-terser");

const STATE_CLASS_SAFE_LIST = new Set([
  "active",
  "checked",
  "disabled",
  "dragging",
  "focus",
  "focused",
  "hidden",
  "hover",
  "is-active",
  "is-dragging",
  "is-focused",
  "is-hidden",
  "is-live",
  "is-open",
  "is-playing",
  "is-selected",
  "maximized",
  "open",
  "playing",
  "selected",
]);

function usage() {
  console.error(
    "Usage: node build-scripts/inline-pruned-css.cjs --html <file> --css <file> --out <file>",
  );
  process.exit(2);
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

const htmlPath = argValue("--html");
const cssPath = argValue("--css");
const outPath = argValue("--out");

if (!htmlPath || !cssPath || !outPath) usage();

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function resolveScriptPath(src, htmlFile) {
  if (!src || /^https?:\/\//i.test(src)) return null;
  const withoutQuery = src.split(/[?#]/, 1)[0];
  const sourceName = withoutQuery.replace(/\.min\.(m?js)$/i, ".$1");
  const candidates = [
    path.resolve(path.dirname(htmlFile), sourceName),
    path.resolve("src", path.basename(sourceName)),
    path.resolve(sourceName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function collectContent(html, htmlFile) {
  const chunks = [html];
  const scriptSrcPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(scriptSrcPattern)) {
    const scriptPath = resolveScriptPath(match[1], htmlFile);
    if (scriptPath) chunks.push(readIfExists(scriptPath));
  }

  if (path.basename(htmlFile) === "index.html") {
    for (const file of fs.readdirSync("src")) {
      if (/\.(mjs|js)$/i.test(file) && !/\.min\./i.test(file)) {
        chunks.push(readIfExists(path.join("src", file)));
      }
    }
  }

  return chunks.join("\n");
}

function collectTokens(content) {
  const classes = new Set(STATE_CLASS_SAFE_LIST);
  const ids = new Set();
  const tags = new Set(["html", "body", "head", "style", "script", "svg", "path"]);

  for (const match of content.matchAll(/\bclass(?:Name)?\s*=\s*["']([^"']+)["']/gi)) {
    for (const token of match[1].split(/\s+/)) {
      if (token) classes.add(token);
    }
  }
  for (const match of content.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    if (match[1]) ids.add(match[1]);
  }
  for (const match of content.matchAll(/<\s*([a-z][a-z0-9-]*)\b/gi)) {
    tags.add(match[1].toLowerCase());
  }

  for (const match of content.matchAll(/["'`]([A-Za-z_][\w-]*)["'`]/g)) {
    classes.add(match[1]);
    ids.add(match[1]);
  }

  return { classes, ids, tags, raw: content };
}

function selectorMatchesContent(selector, tokens) {
  let hasRequirement = false;
  let matches = true;

  csso.syntax.walk(selector, (node) => {
    if (!matches) return;
    if (node.type === "ClassSelector") {
      hasRequirement = true;
      matches =
        tokens.classes.has(node.name) ||
        tokens.raw.includes(node.name) ||
        STATE_CLASS_SAFE_LIST.has(node.name);
    } else if (node.type === "IdSelector") {
      hasRequirement = true;
      matches = tokens.ids.has(node.name) || tokens.raw.includes(node.name);
    } else if (node.type === "TypeSelector") {
      const name = String(node.name || "").toLowerCase();
      if (name && name !== "*") {
        hasRequirement = true;
        matches = tokens.tags.has(name) || tokens.raw.includes(name);
      }
    }
  });

  return !hasRequirement || matches;
}

function pruneCss(css, content) {
  const tokens = collectTokens(content);
  const ast = csso.syntax.parse(css, { positions: false });

  csso.syntax.walk(ast, (node, item, list) => {
    if (node.type !== "Rule" || !node.prelude?.children) return;

    const keptSelectors = node.prelude.children
      .toArray()
      .filter((selector) => selectorMatchesContent(selector, tokens));

    if (keptSelectors.length === 0) {
      list.remove(item);
      return;
    }

    node.prelude.children.clear();
    for (const selector of keptSelectors) {
      node.prelude.children.appendData(selector);
    }
  });

  return csso.minify(csso.syntax.generate(ast), { restructure: true }).css;
}

function inlineCss(html, css) {
  const linkPattern =
    /<link\b(?=[^>]*\brel=["'][^"']*stylesheet[^"']*["'])(?=[^>]*\bhref=["'][^"']*(?:^|\/)?(?:src\/)?main\.css["'])[^>]*>/i;
  const style = `<style>${css}</style>`;
  if (linkPattern.test(html)) {
    return html.replace(linkPattern, style);
  }
  return html;
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function packageVersion() {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  return typeof packageJson.version === "string" ? packageJson.version : "";
}

function applyHtmlTemplateVariables(html) {
  return html.replace(/__EMS_APP_VERSION__/g, escapeHtmlText(packageVersion()));
}

(async () => {
  const html = readIfExists(htmlPath);
  const css = readIfExists(cssPath);
  const content = collectContent(html, htmlPath);
  const prunedCss = pruneCss(css, content);
  const withCss = applyHtmlTemplateVariables(inlineCss(html, prunedCss));
  const minified = await minifyHtml(withCss, {
    collapseWhitespace: true,
    minifyCss: false,
    minifyJS: true,
    removeComments: true,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, minified);
})();
