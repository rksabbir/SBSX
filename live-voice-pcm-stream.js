"use strict";

const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");

/**
 * Child-process-shaped adapter for Discord's raw 48 kHz stereo s16le AudioResource.
 * Keep input (Writable) and output (Readable) separate. The previous implementation used
 * one PassThrough as both stdin and stdout; destroying/closing its readable side could also
 * destroy the writable input and prematurely terminate the live microphone pipeline.
 */
function createLivePcmAudioProcess() {
  const stdout = new PassThrough({ highWaterMark: 128 * 1024 });
  const proc = new EventEmitter();
  let finalized = false;

  proc.stdout = stdout;
  proc.stderr = null;
  proc.exitCode = null;
  proc.killed = false;
  proc.rawPcm = true;
  proc.liveInputBytes = 0;
  proc.failureReason = "";

  const finish = (code, reason = "") => {
    if (finalized) return;
    finalized = true;
    proc.exitCode = code;
    if (reason) proc.failureReason = String(reason).slice(0, 300);
    if (code !== 0) proc.killed = true;
    process.nextTick(() => {
      proc.emit("exit", code, null);
      proc.emit("close", code, null);
    });
  };

  const stdin = new Writable({
    highWaterMark: 128 * 1024,
    write(chunk, encoding, callback) {
      if (finalized || stdout.destroyed || stdout.writableEnded) {
        const err = new Error("PCM output stream is no longer writable");
        err.code = "ERR_LIVE_PCM_OUTPUT_CLOSED";
        callback(err);
        return;
      }
      proc.liveInputBytes += chunk.length;
      try {
        stdout.write(chunk, callback);
      } catch (err) {
        callback(err);
      }
    },
    final(callback) {
      if (!stdout.destroyed && !stdout.writableEnded) stdout.end(callback);
      else callback();
    },
  });
  proc.stdin = stdin;

  stdin.once("finish", () => finish(0));
  stdin.on("error", err => {
    // If stdout was already closed, destroying stdin can itself produce
    // ERR_STREAM_PREMATURE_CLOSE. Preserve the earlier output-close reason instead
    // of replacing the root symptom with this secondary cleanup error.
    const earlierFailure = proc.failureReason;
    const isSecondaryPrematureClose = Boolean(earlierFailure) &&
      (err?.code === "ERR_STREAM_PREMATURE_CLOSE" || /premature close/i.test(String(err?.message || "")));
    if (!proc.failureReason) {
      proc.failureReason = `microphone input write failed: ${err?.code || err?.message || "unknown error"}`;
    }
    finish(1, proc.failureReason);
    if (!stdout.destroyed) stdout.destroy();
    // The adapter's caller listens to this event for true unexpected errors. Do not
    // emit a duplicate synthetic error if the downstream close reason was captured first.
    if (!isSecondaryPrematureClose) proc.emit("error", err);
  });
  stdin.once("close", () => {
    if (!finalized && !stdin.writableEnded) finish(1, "microphone input closed before normal end");
  });
  stdout.on("error", err => {
    proc.failureReason = `Discord audio output failed: ${err?.code || err?.message || "unknown error"}`;
    if (!stdin.destroyed) stdin.destroy();
    finish(1, proc.failureReason);
    proc.emit("error", err);
  });
  stdout.once("close", () => {
    if (!finalized && !stdin.writableEnded) {
      const reason = "Discord audio output closed before microphone input ended";
      proc.failureReason = reason;
      if (!stdin.destroyed) stdin.destroy();
      finish(1, reason);
    }
  });

  proc.kill = () => {
    if (proc.exitCode !== null) return false;
    proc.killed = true;
    proc.failureReason = "live PCM pipeline was stopped";
    if (!stdin.destroyed) stdin.destroy();
    if (!stdout.destroyed) stdout.destroy();
    finish(1, proc.failureReason);
    return true;
  };

  process.nextTick(() => proc.emit("spawn"));
  return proc;
}

module.exports = { createLivePcmAudioProcess };
