const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = process.cwd();
const appRoutePrefix = "/apps/my-train";
const appRoot = path.join(rootDir, "apps", "my-train");
let port = 4175;

const stationSlugByCode = {
    BIS: "bishops-stortford",
    BHM: "birmingham-new-street",
    BMH: "bournemouth",
    BRS: "bristol-temple-meads",
    BTH: "bath-spa",
    BTN: "brighton",
    CBG: "cambridge",
    EDB: "edinburgh",
    EXD: "exeter-st-davids",
    GLC: "glasgow-central",
    GLC: "glasgow-central",
    KGX: "london-kings-cross",
    LDS: "leeds",
    LEI: "leicester",
    LIV: "liverpool-lime-street",
    LST: "london-liverpool-street",
    MAN: "manchester-piccadilly",
    NCL: "newcastle",
    NOT: "nottingham",
    NWI: "norwich",
    OXF: "oxford",
    PAD: "london-paddington",
    PLY: "plymouth",
    RDG: "reading",
    SHF: "sheffield",
    SOU: "southampton-central",
    STP: "london-st-pancras-international",
    VIC: "london-victoria",
    WAT: "london-waterloo",
    YRK: "york"
};

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8"
};

function getContentType(filePath) {
    return contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function buildStationSlug(stationCode) {
    return stationSlugByCode[String(stationCode || "").toUpperCase()] || "";
}

function parseJsonArrayFromHtml(html, marker) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error(`Unable to find ${marker} in National Rail response`);
    }

    const arrayStart = html.indexOf("[", markerIndex);
    if (arrayStart === -1) {
        throw new Error("Unable to find services array start in National Rail response");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = arrayStart; index < html.length; index += 1) {
        const char = html[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === "\\") {
            escaped = inString;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === "[") {
            depth += 1;
        } else if (char === "]") {
            depth -= 1;
            if (depth === 0) {
                return JSON.parse(html.slice(arrayStart, index + 1));
            }
        }
    }

    throw new Error("Unable to parse services array from National Rail response");
}

function normalizeBoardService(service) {
    const departure = service?.departureInfo || {};
    const destination = Array.isArray(service?.destination) ? service.destination[0] : null;
    return {
        rid: service?.rid || "",
        destinationCode: destination?.crs || "",
        destinationName: destination?.locationName || "",
        scheduled: departure?.scheduled || "",
        estimated: departure?.estimated || departure?.scheduled || "",
        actual: departure?.actual || "",
        platform: service?.platform || "",
        operator: service?.operator?.name || "",
        status: service?.status?.status || "",
        stops: service?.journeyDetails?.stops ?? null
    };
}

async function fetchBoardData(fromCode) {
    const slug = buildStationSlug(fromCode);
    if (!slug) {
        throw new Error(`Unsupported station code: ${fromCode}`);
    }

    const url = `https://www.nationalrail.co.uk/live-trains/departures/${slug}/`;
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        }
    });

    if (!response.ok) {
        throw new Error(`National Rail request failed with ${response.status}`);
    }

    const html = await response.text();
    const services = parseJsonArrayFromHtml(html, '"services":');

    return {
        stationCode: String(fromCode).toUpperCase(),
        stationSlug: slug,
        updatedAt: new Date().toISOString(),
        services: services.map(normalizeBoardService)
    };
}

function safeResolve(urlPath) {
    const decoded = decodeURIComponent(urlPath.split("?")[0]);
    const relativePath = decoded === "/" ? "/index.html" : decoded;
    const resolved = path.resolve(rootDir, `.${relativePath}`);

    if (!resolved.startsWith(rootDir)) {
        return null;
    }

    return resolved;
}

function pickFile(requestPath) {
    const resolved = safeResolve(requestPath);
    if (!resolved) {
        return null;
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const indexFile = path.join(resolved, "index.html");
        if (fs.existsSync(indexFile)) {
            return indexFile;
        }
    }

    if (!path.extname(resolved)) {
        const htmlFile = `${resolved}.html`;
        if (fs.existsSync(htmlFile)) {
            return htmlFile;
        }

        const indexFile = path.join(resolved, "index.html");
        if (fs.existsSync(indexFile)) {
            return indexFile;
        }
    }

    return null;
}

async function handleApiRequest(req, res) {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const from = url.searchParams.get("from") || "";

    if (!from) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Missing from station code" }));
        return;
    }

    try {
        const data = await fetchBoardData(from);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
    } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message }));
    }
}

function sendFile(res, filePath) {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Cache-Control": "no-store"
    });
    res.end(data);
}

function startBrowser() {
    const url = `http://127.0.0.1:${port}${appRoutePrefix}/`;
    const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });
    child.unref();
}

function main() {
    const server = http.createServer((req, res) => {
        const requestPath = req.url || "/";

        if (requestPath.startsWith("/api/board")) {
            handleApiRequest(req, res).catch((error) => {
                res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: error.message }));
            });
            return;
        }

        const filePath = pickFile(requestPath);
        if (filePath) {
            sendFile(res, filePath);
            return;
        }

        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
    });

    const startListening = () => {
        server.listen(port, "127.0.0.1", () => {
            console.log(`My Train available at http://127.0.0.1:${port}${appRoutePrefix}/`);
            startBrowser();
        });
    };

    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            port += 1;
            startListening();
            return;
        }

        throw error;
    });

    startListening();

    process.on("SIGINT", () => server.close(() => process.exit(0)));
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

main();
