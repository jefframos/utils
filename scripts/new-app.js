const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const appsDir = path.join(rootDir, "apps");

function toTitleCaseFromSlug(slug) {
    return slug
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sanitizeSlug(input) {
    return String(input || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-_]/g, "")
        .replace(/-+/g, "-");
}

function getRequestedName() {
    const directArg = process.argv.slice(2).find((arg) => arg && !arg.startsWith("-"));
    return directArg || "";
}

function createAppFiles(slug) {
    const appTitle = toTitleCaseFromSlug(slug);
    const appDir = path.join(appsDir, slug);

    if (fs.existsSync(appDir)) {
        throw new Error(`App already exists: apps/${slug}`);
    }

    fs.mkdirSync(appDir, { recursive: true });

    const appJson = {
        name: appTitle,
        description: `Describe what ${appTitle} does`
    };

    fs.writeFileSync(path.join(appDir, "app.json"), `${JSON.stringify(appJson, null, 2)}\n`, "utf8");

    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${appTitle}</title>
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(145deg, #e7f5ff, #fff4e6);
        }

        .card {
            width: min(720px, 92vw);
            padding: 1.5rem;
            border-radius: 14px;
            border: 1px solid rgba(0, 0, 0, 0.1);
            background: rgba(255, 255, 255, 0.86);
        }

        h1 {
            margin-top: 0;
        }

        a {
            color: #0b7285;
        }
    </style>
</head>
<body>
    <section class="card">
        <h1>${appTitle}</h1>
        <p>New app scaffold created. Start building your utility here.</p>
        <p><a href="../../index.html">Back to all apps</a></p>
    </section>
</body>
</html>
`;

    fs.writeFileSync(path.join(appDir, "index.html"), html, "utf8");
}

function main() {
    if (!fs.existsSync(appsDir)) {
        fs.mkdirSync(appsDir, { recursive: true });
    }

    const rawName = getRequestedName();
    const slug = sanitizeSlug(rawName);

    if (!slug) {
        console.error("Please provide an app name. Example: npm run new:app -- json-formatter");
        process.exit(1);
    }

    createAppFiles(slug);
    console.log(`Created app scaffold: apps/${slug}`);
    console.log("Run `npm run build` to refresh root index.html menu.");
}

main();
