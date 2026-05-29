const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const rootDir = process.cwd();
const appsDir = path.join(rootDir, "apps");
const hubDir = path.join(rootDir, "hub");
const hubTemplatePath = path.join(hubDir, "index.template.html");
const generateMenuScript = path.join(rootDir, "scripts", "generate-menu.js");
const viteEntry = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

function runBuild() {
    execFileSync(process.execPath, [generateMenuScript], {
        cwd: rootDir,
        stdio: "inherit"
    });
}

function isRelevant(filePath) {
    if (!filePath) {
        return false;
    }

    if (filePath.endsWith(".tmp") || filePath.includes("node_modules")) {
        return false;
    }

    const normalized = filePath.replace(/\\/g, "/");
    return normalized.includes("/apps/") || normalized.endsWith("/hub/index.template.html");
}

function watchAndRebuild() {
    let timer = null;

    const watcher = fs.watch(rootDir, { recursive: true }, (_eventType, changedPath) => {
        if (!changedPath) {
            return;
        }

        const absolutePath = path.join(rootDir, changedPath);
        if (!isRelevant(absolutePath)) {
            return;
        }

        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            try {
                runBuild();
            } catch (error) {
                console.error("Rebuild failed:", error.message);
            }
        }, 150);
    });

    return watcher;
}

function ensureSetup() {
    if (!fs.existsSync(viteEntry)) {
        console.error("Vite is not installed yet. Run: npm install");
        process.exit(1);
    }

    if (!fs.existsSync(appsDir)) {
        fs.mkdirSync(appsDir, { recursive: true });
    }

    if (!fs.existsSync(hubDir)) {
        fs.mkdirSync(hubDir, { recursive: true });
    }

    if (!fs.existsSync(hubTemplatePath)) {
        console.error("Missing hub template: hub/index.template.html");
        process.exit(1);
    }
}

function main() {
    ensureSetup();
    runBuild();

    const watcher = watchAndRebuild();

    console.log("Hub dev server started. Root index.html will rebuild when hub/apps files change.");
    const vite = spawn(process.execPath, [viteEntry, rootDir, "--open"], {
        cwd: rootDir,
        stdio: "inherit",
        env: process.env
    });

    const shutdown = () => {
        watcher.close();
        if (!vite.killed) {
            vite.kill();
        }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    vite.on("exit", (code) => {
        shutdown();
        process.exit(code ?? 0);
    });
}

main();
