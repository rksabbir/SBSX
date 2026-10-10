"use strict";

const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

/**
 * Wrap raw 48 kHz stereo s16le PCM as a child-process-like object so the existing Discord
 * AudioPlayer lifecycle can consume a Readable stream. No converter/container parser is needed.
 * `stdin` and `stdout` intentionally share one PassThrough so bytes are relayed unchanged.
 */
function createLivePcmAudioProcess() {
  const stream = new PassThrough({ highWaterMark: 128 * 1024 });
  const processLike = new EventEmitter();
  processLike.stdin = stream;
  processLike.stdout = stream;
  processLike.stderr = null;
  processLike.exitCode = null;
  processLike.killed = false;
  processLike.rawPcm = true;
  processLike.liveInputBytes = 0;
  let finalized = false;

  const finish = code => {
    if (finalized) return;
    finalized = true;
    processLike.exitCode = code;
    if (code !== 0) processLike.killed = true;
    process.nextTick(() => {
      processLike.emit("exit", code, null);
      processLike.emit("close", code, null);
    });
  };

  stream.once("end", () => finish(0));
  stream.on("error", err => {
    processLike.emit("error", err);
    finish(1);
  });
  stream.once("close", () => {
    if (!finalized) finish(stream.readableEnded ? 0 : 1);
  });
  processLike.kill = () => {
    if (processLike.exitCode !== null) return false;
    processLike.killed = true;
    try { stream.destroy(); } catch (_) {}
    finish(1);
    return true;
  };

  process.nextTick(() => processLike.emit("spawn"));
  return processLike;
}

module.exports = { createLivePcmAudioProcess };
