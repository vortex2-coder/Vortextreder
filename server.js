const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createTokenHandler } = require("./api/oauth/token");

const root = __dirname;
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/callback": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

const tokenHandler = createTokenHandler({
  expectedRedirectUri: `http://localhost:${process.env.PORT || 4173}/callback`,
});

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;

  if (pathname === "/api/oauth/token") {
    if (request.method !== "POST") {
      await tokenHandler(request, response);
      return;
    }

    let rawBody = "";
    for await (const chunk of request) {
      rawBody += chunk;
      if (rawBody.length > 8192) {
        response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Request body is too large." }));
        return;
      }
    }

    try {
      request.body = JSON.parse(rawBody);
    } catch {
      request.body = null;
    }

    await tokenHandler(request, response);
    return;
  }

  const file = files[pathname];

  if (!file || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const [filename, contentType] = file;
  const content = fs.readFileSync(path.join(root, filename));

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : content);
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`Northstar Markets is running at http://localhost:${port}`);
});
