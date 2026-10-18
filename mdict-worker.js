"use strict";

const { parentPort, workerData } = require("node:worker_threads");

let dictionary;
let resourceDictionary;
let resourceStartupError = "";

function useLazyMdictLookup(Mdict) {
  const lookup = Mdict.prototype.lookup;
  Mdict.prototype._decodeKeyBlock = function () {
    this._keyBlockStartOffset = this._keyBlockInfoEndOffset;
    this._keyBlockEndOffset = this._keyBlockStartOffset + this.keyHeader.keyBlocksTotalSize;
  };
  Mdict.prototype._keyToBuffer = function () {};
  Mdict.prototype.lookup = function (word) {
    if (this.ext !== "mdx") return lookup.call(this, word);
    const record = this._lookupKID(word);
    if (!record) return { keyText: word, definition: null };
    const { idx, list } = record;
    const current = list[idx];
    const nextStart = idx + 1 < list.length
      ? list[idx + 1].recordStartOffset
      : this._recordBlockStartOffset
        + this.recordBlockInfoList[this.recordBlockInfoList.length - 1].decompAccumulator
        + this.recordBlockInfoList[this.recordBlockInfoList.length - 1].decompSize;
    const recordBlockId = this._reduceRecordBlock(current.recordStartOffset);
    return this._decodeRecordBlockByRBID(
      recordBlockId,
      current.keyText,
      current.recordStartOffset,
      nextStart
    );
  };
}

function resolveEntry(query) {
  const visited = new Set();
  let entry = dictionary.lookup(query);
  for (let step = 0; entry && step < 8; step++) {
    const definition = String(entry.definition || "");
    const link = definition.match(/^\s*@@@LINK=(.+?)\s*(?:\u0000)?$/m);
    if (!link) return entry;
    const target = link[1].trim();
    if (!target || visited.has(target)) return null;
    visited.add(target);
    entry = dictionary.lookup(target);
  }
  return entry;
}

try {
  const Mdict = require("mdict-js").default;
  useLazyMdictLookup(Mdict);
  dictionary = new Mdict(workerData.dictionaryPath);
  if (workerData.mddPath) {
    try {
      resourceDictionary = new Mdict(workerData.mddPath);
    } catch (error) {
      resourceStartupError = error.message || "配套 MDD 无法初始化。";
    }
  }
  parentPort.postMessage({ type: "ready" });
} catch (error) {
  parentPort.postMessage({ type: "startup-error", error: `词典无法初始化：${error.message || "格式不受支持或文件已损坏。"}` });
}

parentPort.on("message", ({ id, query, resourceKey }) => {
  try {
    if (resourceKey) {
      if (!resourceDictionary) {
        throw new Error(resourceStartupError || "此词典没有可读取的配套 MDD。");
      }
      const resource = resourceDictionary.lookup(resourceKey);
      const data = String(resource?.definition || "");
      if (!data) {
        parentPort.postMessage({ id, resource: null });
        return;
      }
      const decoded = Buffer.from(data, "base64");
      const transferable = decoded.byteOffset === 0 && decoded.byteLength === decoded.buffer.byteLength
        ? decoded
        : Uint8Array.from(decoded);
      parentPort.postMessage({
        id,
        resource: { keyText: String(resource.keyText || resourceKey), data: transferable.buffer }
      }, [transferable.buffer]);
      return;
    }
    const entry = resolveEntry(query);
    const definition = String(entry?.definition || "").replace(/\u0000/g, "");
    parentPort.postMessage({
      id,
      results: entry && definition.trim() ? [{ keyText: String(entry.keyText || query), definition }] : []
    });
  } catch (error) {
    const message = error.message || "";
    parentPort.postMessage({
      id,
      error: resourceKey ? "MDD 资源读取失败；该资源可能不存在或格式不受支持。"
        : "查询失败；该词典条目格式可能不受支持。"
    });
  }
});
