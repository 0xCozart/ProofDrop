import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import { createProofDropApiFromEnv } from "./api.js";

const publicDir = join(process.cwd(), "public");
const port = Number(process.env.PROOFDROP_PORT ?? "4177");
const bindHost = process.env.PROOFDROP_HOST ?? "127.0.0.1";
const api = createProofDropApiFromEnv(process.env);

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const host = request.headers.host ?? `127.0.0.1:${port}`;
  const url = new URL(request.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const method = request.method ?? "GET";
  const bodyBytes = method === "GET" || method === "HEAD" ? undefined : await requestBody(request);
  const body = bodyBytes === undefined ? undefined : bodyBytes.toString("utf8");
  return new Request(url, { method, headers, body });
}

async function sendResponse(nodeResponse: ServerResponse, response: Response): Promise<void> {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
  const body = response.body === null ? undefined : Buffer.from(await response.arrayBuffer());
  nodeResponse.end(body);
}

async function staticResponse(pathname: string): Promise<Response> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalized);
  if (!filePath.startsWith(publicDir)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const server = createServer(async (request, response) => {
  try {
    const webRequest = await toWebRequest(request);
    const url = new URL(webRequest.url);
    const webResponse = url.pathname.startsWith("/api/") ? await api.handle(webRequest) : await staticResponse(url.pathname);
    await sendResponse(response, webResponse);
  } catch {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "INTERNAL_ERROR", message: "Internal server error." }));
  }
});

server.listen(port, bindHost, () => {
  console.log(`Gasless ProofDrop listening on http://${bindHost}:${port}`);
});
