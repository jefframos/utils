const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const appsDir = path.join(rootDir, "apps");
const hubTemplatePath = path.join(rootDir, "hub", "index.template.html");
const legacyTemplatePath = path.join(rootDir, "index.template.html");
const outputPath = path.join(rootDir, "index.html");

function resolveTemplatePath() {
    const explicitTemplateArg = process.argv.slice(2).find((arg) => arg && !arg.startsWith("-"));
    if (explicitTemplateArg) {
        const absoluteExplicitPath = path.isAbsolute(explicitTemplateArg)
            ? explicitTemplateArg
            : path.join(rootDir, explicitTemplateArg);
        if (fs.existsSync(absoluteExplicitPath)) {
            return absoluteExplicitPath;
        }
        throw new Error(`Template not found: ${absoluteExplicitPath}`);
    }

    if (fs.existsSync(hubTemplatePath)) {
        return hubTemplatePath;
    }

    if (fs.existsSync(legacyTemplatePath)) {
        return legacyTemplatePath;
    }

    throw new Error("Missing template. Expected hub/index.template.html or index.template.html in project root.");
}

function toTitleCaseFromSlug(slug) {
    return slug
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeReadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

function getApps() {
    if (!fs.existsSync(appsDir)) {
        return [];
    }

    const entries = fs.readdirSync(appsDir, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => {
            const folderName = entry.name;
            const appFolder = path.join(appsDir, folderName);
            const appIndexPath = path.join(appFolder, "index.html");

            if (!fs.existsSync(appIndexPath)) {
                return null;
            }

            const metadataPath = path.join(appFolder, "app.json");
            const metadata = fs.existsSync(metadataPath)
                ? safeReadJson(metadataPath)
                : null;

            const name = metadata?.name || toTitleCaseFromSlug(folderName);
            const description = metadata?.description || "";

            return {
                folderName,
                name,
                description,
                href: `apps/${folderName}/`
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function buildMenuHtml(apps) {
    if (apps.length === 0) {
        return `<p class="empty">No apps found yet. Add a folder inside <code>apps/</code> with an <code>index.html</code> file, then run <code>npm run build</code>.</p>`;
    }

    return `<ul class="app-grid">\n${apps
        .map(
            (app) =>
                `  <li class="app-item">\n    <article class="app-surface">\n      <div class="app-meta">\n        <h2>${escapeHtml(
                    app.name
                )}</h2>\n        <p>${escapeHtml(
                    app.description || `Open ${app.name}`
                )}</p>\n      </div>\n      <div class="actions">\n        <md-assist-chip class="app-path" label="${escapeHtml(
                    app.href
                )}"></md-assist-chip>\n        <a href="${app.href}" class="app-link">\n          <md-filled-tonal-button>Open App</md-filled-tonal-button>\n        </a>\n      </div>\n    </article>\n  </li>`
        )
        .join("\n")}\n</ul>`;
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function main() {
    const apps = getApps();
    const templatePath = resolveTemplatePath();
    const template = fs.readFileSync(templatePath, "utf8");
    const menuHtml = buildMenuHtml(apps);
    const output = template.replace("<!-- APP_MENU -->", menuHtml);

    fs.writeFileSync(outputPath, output);
    console.log(`Generated index.html with ${apps.length} app(s).`);
}

main();