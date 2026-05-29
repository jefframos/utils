const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = process.cwd();
const envFilePath = path.join(rootDir, ".env");
const appsDir = path.join(rootDir, "apps");

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const values = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const idx = trimmed.indexOf("=");
        if (idx === -1) {
            continue;
        }

        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        values[key] = value;
    }

    return values;
}

function writeOrUpdateEnvVar(filePath, key, value) {
    const nextLine = `${key}=${value}`;
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `${nextLine}\n`, "utf8");
        return;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    let updated = false;
    const out = lines.map((line) => {
        if (line.trim().startsWith(`${key}=`)) {
            updated = true;
            return nextLine;
        }
        return line;
    });

    if (!updated) {
        if (out.length > 0 && out[out.length - 1] !== "") {
            out.push("");
        }
        out.push(nextLine);
    }

    fs.writeFileSync(filePath, `${out.join("\n")}\n`, "utf8");
}

function appExists(appName) {
    const appPath = path.join(appsDir, appName);
    const appIndex = path.join(appPath, "index.html");
    return fs.existsSync(appPath) && fs.statSync(appPath).isDirectory() && fs.existsSync(appIndex);
}

function resolveRequestedApp() {
    const directArg = process.argv.slice(2).find((arg) => arg && !arg.startsWith("-"));
    if (directArg) {
        return directArg;
    }

    // Support npm start <app> and npm run serve <app> forms.
    const npmArgvRaw = process.env.npm_config_argv;
    if (npmArgvRaw) {
        try {
            const parsed = JSON.parse(npmArgvRaw);
            const original = Array.isArray(parsed?.original) ? parsed.original : [];
            for (const commandName of ["start", "serve"]) {
                const commandIndex = original.findIndex((v) => v === commandName);
                if (commandIndex !== -1) {
                    const maybeApp = original[commandIndex + 1];
                    if (maybeApp && maybeApp !== "--" && !maybeApp.startsWith("-")) {
                        return maybeApp;
                    }
                }
            }
        } catch {
            // Ignore malformed npm_config_argv.
        }
    }

    const envValues = readEnvFile(envFilePath);
    return envValues.CURRENT_APP || "";
}

function ensureAppOrExit(appName) {
    if (!appName) {
        console.error("No app selected. Set CURRENT_APP in .env or run: npm start -- <app-name>");
        process.exit(1);
    }

    if (!appExists(appName)) {
        const appPath = path.join("apps", appName, "index.html");
        console.error(`App not found: ${appPath}`);
        process.exit(1);
    }
}

function run() {
    const appName = resolveRequestedApp();
    ensureAppOrExit(appName);

    writeOrUpdateEnvVar(envFilePath, "CURRENT_APP", appName);

    const appRoot = path.join(appsDir, appName);
    const viteEntry = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

    if (!fs.existsSync(viteEntry)) {
        console.error("Vite is not installed yet. Run: npm install");
        process.exit(1);
    }

    console.log(`Starting app: ${appName}`);
    const child = spawn(process.execPath, [viteEntry, appRoot, "--open"], {
        stdio: "inherit",
        env: {
            ...process.env,
            CURRENT_APP: appName
        }
    });

    child.on("exit", (code) => {
        process.exit(code ?? 0);
    });
}

run();
