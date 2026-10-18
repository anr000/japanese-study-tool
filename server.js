"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const dictionaryRoot = path.join(root, "词典");
const mddResourceTypes = new Map([
  [".png", { contentType: "image/png", signature: data => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  [".jpg", { contentType: "image/jpeg", signature: data => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff }],
  [".jpeg", { contentType: "image/jpeg", signature: data => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff }],
  [".gif", { contentType: "image/gif", signature: data => ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)) }],
  [".webp", { contentType: "image/webp", signature: data => data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" }],
  [".mp3", { contentType: "audio/mpeg", signature: data => data.toString("ascii", 0, 3) === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) }],
  [".ogg", { contentType: "audio/ogg", signature: data => data.toString("ascii", 0, 4) === "OggS" }],
  [".wav", { contentType: "audio/wav", signature: data => data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE" }],
  [".css", { contentType: "text/css; charset=utf-8" }],
  [".js", { contentType: "text/javascript; charset=utf-8" }],
  [".woff", { contentType: "font/woff", signature: data => data.toString("ascii", 0, 4) === "wOFF" }],
  [".woff2", { contentType: "font/woff2", signature: data => data.toString("ascii", 0, 4) === "wOF2" }],
  [".ttf", { contentType: "font/ttf", signature: data => data.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || data.toString("ascii", 0, 4) === "true" }],
  [".otf", { contentType: "font/otf", signature: data => data.toString("ascii", 0, 4) === "OTTO" }]
]);
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/api-config.js", ["api-config.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

const localConfigPath = path.join(root, "api-config.js");
if (!fs.existsSync(localConfigPath)) {
  fs.copyFileSync(path.join(root, "api-config.example.js"), localConfigPath);
}

function scanMdictFiles() {
  if (!fs.existsSync(dictionaryRoot)) return [];
  const filesFound = [];
  const visit = (directory, depth) => {
    if (depth > 10) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".mdx") {
        const relativePath = path.relative(dictionaryRoot, fullPath);
        const id = crypto.createHash("sha256").update(relativePath.toLowerCase()).digest("hex").slice(0, 16);
        const baseName = path.basename(fullPath, path.extname(fullPath));
        const siblings = fs.readdirSync(directory);
        const pairedMdd = siblings.find(name =>
          path.extname(name).toLowerCase() === ".mdd"
          && path.basename(name, path.extname(name)).toLowerCase() === baseName.toLowerCase());
        const pairedCss = siblings.find(name =>
          path.extname(name).toLowerCase() === ".css"
          && path.basename(name, path.extname(name)).toLowerCase() === baseName.toLowerCase());
        const mddPath = pairedMdd ? path.join(directory, pairedMdd) : "";
        const cssPath = pairedCss ? path.join(directory, pairedCss) : "";
        const mdxStat = fs.statSync(fullPath);
        const mddStat = mddPath ? fs.statSync(mddPath) : null;
        const cssStat = cssPath ? fs.statSync(cssPath) : null;
        const sourceFingerprint = [
          mdxStat.size,
          mdxStat.mtimeMs,
          mddStat?.size || 0,
          mddStat?.mtimeMs || 0,
          cssStat?.size || 0,
          cssStat?.mtimeMs || 0
        ].join(":");
        filesFound.push({
          id,
          name: baseName,
          fileName: entry.name,
          relativePath,
          hasMdd: Boolean(pairedMdd),
          sizeBytes: mdxStat.size,
          modifiedAt: mdxStat.mtime.toISOString(),
          mddSizeBytes: mddStat?.size || 0,
          mddModifiedAt: mddStat?.mtime.toISOString() || "",
          hasStylesheet: Boolean(cssPath),
          sourceFingerprint,
          mddPath,
          cssPath,
          path: fullPath
        });
      }
    }
  };
  visit(dictionaryRoot, 0);
  return filesFound.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

let currentWorker = null;
let workerSequence = 0;
let requestSequence = 0;
let workerOperationQueue = Promise.resolve();

function stopCurrentWorker(reason) {
  if (!currentWorker) return;
  const workerState = currentWorker;
  currentWorker = null;
  for (const pending of workerState.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(reason);
  }
  workerState.pending.clear();
  workerState.rejectReady(reason);
  workerState.worker.terminate().catch(() => {});
}

function startMdictWorker(source) {
  stopCurrentWorker(new Error("MDict 来源已切换。"));
  const worker = new Worker(path.join(root, "mdict-worker.js"), {
    workerData: { dictionaryPath: source.path, mddPath: source.mddPath }
  });
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const workerState = {
    id: source.id,
    fingerprint: source.sourceFingerprint,
    sequence: ++workerSequence,
    worker,
    ready,
    resolveReady,
    rejectReady,
    isReady: false,
    pending: new Map()
  };
  currentWorker = workerState;
  const startupTimeout = setTimeout(() => {
    if (currentWorker === workerState && !workerState.isReady) {
      const error = new Error("词典索引初始化超时；请确认文件未损坏并检查可用内存。");
      stopCurrentWorker(error);
    }
  }, 120000);
  worker.on("message", message => {
    if (currentWorker !== workerState) return;
    if (message.type === "ready") {
      workerState.isReady = true;
      clearTimeout(startupTimeout);
      workerState.resolveReady();
      return;
    }
    if (message.type === "startup-error") {
      clearTimeout(startupTimeout);
      stopCurrentWorker(new Error(message.error || "无法读取此 MDX 词典。"));
      return;
    }
    const pending = workerState.pending.get(message.id);
    if (!pending) return;
    workerState.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.resource || message.results);
  });
  worker.on("error", error => {
    if (currentWorker === workerState) stopCurrentWorker(new Error(`词典读取失败：${error.message}`));
  });
  worker.on("exit", code => {
    if (currentWorker === workerState) {
      stopCurrentWorker(new Error(code === 0 ? "词典索引已关闭。" : "词典文件不受支持、已损坏或超出可用内存。"));
    }
  });
  return workerState;
}

function queuedWorkerLookup(source, payload, timeoutMessage) {
  const operation = workerOperationQueue.then(async () => {
    let workerState = currentWorker;
    if (!workerState || workerState.id !== source.id || workerState.fingerprint !== source.sourceFingerprint) {
      workerState = startMdictWorker(source);
    }
    await workerState.ready;
    if (currentWorker !== workerState) throw new Error("词典来源已切换，请重新查询。");
    const id = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopCurrentWorker(new Error(timeoutMessage));
      }, 30000);
      workerState.pending.set(id, { resolve, reject, timeout });
      workerState.worker.postMessage({ id, ...payload });
    });
  });
  workerOperationQueue = operation.catch(() => {});
  return operation;
}

function lookupMdict(source, query) {
  return queuedWorkerLookup(source, { query }, "词典查询超时；工作线程已重启，请重新查询。");
}

function lookupMddResource(source, resourceKey) {
  if (!source.mddPath) return Promise.reject(new Error("此词典没有配套 MDD 资源文件。"));
  return queuedWorkerLookup(source, { resourceKey }, "MDD 资源读取超时；工作线程已重启，请重新查询。");
}

function resolveMddResourceKey(parentKey, reference) {
  const value = String(reference || "").trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!value || /^(?:https?:|data:|javascript:|file:|\/\/|#)/i.test(value)) return "";
  let decoded;
  try {
    decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
  } catch {
    return "";
  }
  if (!decoded || /[\u0000-\u001f\u007f:]/.test(decoded)) return "";
  const base = decoded.startsWith("/") ? "" : path.posix.dirname(parentKey.replace(/^\\/, "").replace(/\\/g, "/"));
  const normalized = path.posix.normalize(path.posix.join(base, decoded.replace(/^\/+/, "")));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return "";
  return `\\${normalized.split("/").filter(Boolean).join("\\")}`;
}

function mddResourceUrl(sourceId, key) {
  const params = new URLSearchParams({ id: sourceId, key });
  return `/api/dictionary/resource?${params}`;
}

function rewriteMddCss(css, sourceId, stylesheetKey) {
  const url = reference => {
    const key = resolveMddResourceKey(stylesheetKey, reference);
    return key && mddResourceTypes.has(path.extname(key).toLowerCase())
      ? mddResourceUrl(sourceId, key)
      : "";
  };
  return css
    .replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi, (match, quote, quoted, bare) => {
      const target = url((quoted ?? bare ?? "").trim());
      return target ? `url("${target}")` : "url(\"\")";
    })
    .replace(/@import\s+(["'])(.*?)\1/gi, (match, quote, reference) => {
      const target = url(reference);
      return target ? `@import url("${target}")` : "";
    });
}

function sendMddResource(response, resource, sourceId) {
  const extension = path.extname(resource.keyText).toLowerCase();
  const type = mddResourceTypes.get(extension);
  if (!type) {
    sendJson(response, 415, { error: "该 MDD 资源格式不支持预览。" });
    return;
  }
  const data = Buffer.from(resource.data);
  if (!data.length) {
    sendJson(response, 404, { error: "MDD 资源为空。" });
    return;
  }
  if (type.signature && !type.signature(data)) {
    sendJson(response, 415, { error: "MDD 文件扩展名与资源内容不匹配，已拒绝预览。" });
    return;
  }
  const body = extension === ".css"
    ? Buffer.from(rewriteMddCss(data.toString("utf8"), sourceId, resource.keyText), "utf8")
    : data;
  response.writeHead(200, {
    "Content-Type": type.contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline"
  });
  response.end(body);
}

function sendDictionaryStylesheet(response, source) {
  const keyText = `\\${path.basename(source.cssPath)}`;
  const resource = {
    keyText,
    data: fs.readFileSync(source.cssPath)
  };
  sendMddResource(response, resource, source.id);
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/dictionaries") {
    try {
      const dictionaries = scanMdictFiles().map(({ path: ignored, mddPath: ignoredMddPath, cssPath: ignoredCssPath, ...dictionary }) => dictionary);
      sendJson(response, 200, { dictionaries });
    } catch (error) {
      console.error("扫描本地 MDict 文件失败", error);
      sendJson(response, 500, { error: "无法读取项目中的词典目录。" });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/dictionary/search-all") {
    const query = (url.searchParams.get("q") || "").trim();
    if (!query || query.length > 100) {
      sendJson(response, 400, { error: "查询词不能为空且长度不能超过 100 个字符。" });
      return;
    }
    try {
      const dictionaries = scanMdictFiles();
      const results = [];
      for (const source of dictionaries) {
        try {
          const entries = await lookupMdict(source, query);
          if (entries.length) {
            results.push({
              source: {
                id: source.id,
                name: source.name,
                fileName: source.fileName,
                relativePath: source.relativePath,
                sizeBytes: source.sizeBytes,
                hasMdd: source.hasMdd,
                sourceFingerprint: source.sourceFingerprint
              },
              results: entries
            });
          }
        } catch (error) {
          results.push({
            source: { id: source.id, name: source.name, fileName: source.fileName },
            error: error.message || "此词典查询失败。"
          });
        }
      }
      sendJson(response, 200, { query, results });
    } catch (error) {
      console.error("本地 MDict 全词典查询失败", error.message);
      sendJson(response, 500, { error: error.message || "无法扫描本地词典。" });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/dictionary/search") {
    const id = url.searchParams.get("id") || "";
    const query = (url.searchParams.get("q") || "").trim();
    if (!query || query.length > 100) {
      sendJson(response, 400, { error: "查询词不能为空且长度不能超过 100 个字符。" });
      return;
    }
    try {
      const source = scanMdictFiles().find(dictionary => dictionary.id === id);
      if (!source) {
        sendJson(response, 404, { error: "找不到该 MDX 文件；请确认文件仍位于项目的「词典」目录中。" });
        return;
      }
      const results = await lookupMdict(source, query);
      sendJson(response, 200, {
        source: {
          id: source.id,
          name: source.name,
          fileName: source.fileName,
          relativePath: source.relativePath,
          sizeBytes: source.sizeBytes,
          hasMdd: source.hasMdd,
          mddSizeBytes: source.mddSizeBytes,
          modifiedAt: source.modifiedAt,
          mddModifiedAt: source.mddModifiedAt,
          sourceFingerprint: source.sourceFingerprint
        },
        query,
        results
      });
    } catch (error) {
      console.error("本地 MDict 查询失败", error.message);
      sendJson(response, 422, { error: error.message || "无法读取该词典。" });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/dictionary/resource") {
    const id = url.searchParams.get("id") || "";
    const requestedKey = url.searchParams.get("key") || "";
    const normalizedKey = requestedKey.replace(/\//g, "\\");
    const segments = normalizedKey.split("\\").filter(Boolean);
    if (!requestedKey || requestedKey.length > 512 || /[\u0000-\u001f\u007f:]/.test(requestedKey)
      || segments.some(segment => segment === "." || segment === "..")) {
      sendJson(response, 400, { error: "MDD 资源路径无效。" });
      return;
    }
    try {
      const source = scanMdictFiles().find(dictionary => dictionary.id === id);
      if (!source) {
        sendJson(response, 404, { error: "找不到该 MDX 文件。" });
        return;
      }
      if (!mddResourceTypes.has(path.extname(normalizedKey).toLowerCase())) {
        sendJson(response, 415, { error: "该 MDD 资源格式不支持预览。" });
        return;
      }
      const key = `\\${segments.join("\\")}`;
      const isStylesheet = path.extname(key).toLowerCase() === ".css";
      const resource = source.mddPath ? await lookupMddResource(source, key) : null;
      if (!resource) {
        if (isStylesheet && source.cssPath) {
          sendDictionaryStylesheet(response, source);
          return;
        }
        sendJson(response, 404, { error: "该词典中没有找到此 MDD 资源。" });
        return;
      }
      sendMddResource(response, resource, source.id);
    } catch (error) {
      console.error("本地 MDD 资源读取失败", error.message);
      sendJson(response, 422, { error: error.message || "无法读取此 MDD 资源。" });
    }
    return;
  }
  const route = files.get(url.pathname);
  if (!route || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Not found");
    return;
  }
  const [file, contentType] = route;
  fs.readFile(path.join(root, file), (error, data) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Unable to read application file");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
});

server.on("close", () => stopCurrentWorker(new Error("本地服务已关闭。")));
server.listen(port, "127.0.0.1", () => {
  console.log(`ことば帳 is available at http://127.0.0.1:${port}`);
});
