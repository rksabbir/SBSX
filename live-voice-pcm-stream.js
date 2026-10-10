"use strict";

const { EventEmitter } = require("node:events");
const { Readable, Writable } = require("node:stream");

const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_FRAME_MS = 20;
const PCM_FRAME_SAMPLES = PCM_SAMPLE_RATE * PCM_FRAME_MS / 1000;
const PCM_FRAME_BYTES = PCM_FRAME_SAMPLES * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE; // 3840 bytes
const MAX_QUEUED_PCM_BYTES = PCM_FRAME_BYTES * 10; // cap latency at roughly 200 ms

/**
 * A clocked, frame-aligned PCM source for Discord's AudioPlayer.
 *
 * WebSocket packets are bursty and may briefly pause. Exposing the socket chunks
 * directly as a readable stream lets the AudioPlayer interpret a short packet gap
 * as an ended/underrun resource and transition to Idle. This source emits one exact
 * 20 ms raw PCM frame per tick, padding missing input with silence, so transient
 * packet jitter does not end the Discord resource. Input remains in memory only.
 */
class ClockedPcmReadable extends Readable {
  constructor(proc) {
    super({ highWaterMark: PCM_FRAME_BYTES * 5 });
    this.proc = proc;
    this.queue = [];
    this.queueHeadOffset = 0;
    this.queuedBytes = 0;
    this.blocked = false;
    this.stopping = false;
    this.explicitlyFinished = false;
    this.timer = setInterval(() => this.emitFrame(), PCM_FRAME_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  _read() {
    this.blocked = false;
  }

  enqueue(chunk) {
    if (this.destroyed || this.stopping) throw new Error("PCM output stream is closed");
    const copy = Buffer.from(chunk);
    if (!copy.length) return;
    this.queue.push(copy);
    this.queuedBytes += copy.length;
    if (this.queuedBytes > MAX_QUEUED_PCM_BYTES) {
      // Prefer current speech over stale buffered audio; keep stereo sample alignment.
      let drop = this.queuedBytes - MAX_QUEUED_PCM_BYTES;
      drop += (4 - (drop % 4)) % 4;
      this.dropOldest(drop);
      this.proc.droppedInputBytes = (this.proc.droppedInputBytes || 0) + drop;
    }
  }

  dropOldest(byteCount) {
    let remaining = Math.min(byteCount, this.queuedBytes);
    while (remaining > 0 && this.queue.length) {
      const head = this.queue[0];
      const available = head.length - this.queueHeadOffset;
      const take = Math.min(remaining, available);
      this.queueHeadOffset += take;
      this.queuedBytes -= take;
      remaining -= take;
      if (this.queueHeadOffset >= head.length) {
        this.queue.shift();
        this.queueHeadOffset = 0;
      }
    }
  }

  takeFrame() {
    const frame = Buffer.alloc(PCM_FRAME_BYTES); // missing samples are silence (s16le zero)
    let written = 0;
    while (written < PCM_FRAME_BYTES && this.queue.length) {
      const head = this.queue[0];
      const available = head.length - this.queueHeadOffset;
      const take = Math.min(PCM_FRAME_BYTES - written, available);
      head.copy(frame, written, this.queueHeadOffset, this.queueHeadOffset + take);
      this.queueHeadOffset += take;
      written += take;
      this.queuedBytes -= take;
      if (this.queueHeadOffset >= head.length) {
        this.queue.shift();
        this.queueHeadOffset = 0;
      }
    }
    if (written < PCM_FRAME_BYTES) this.proc.underrunFrames = (this.proc.underrunFrames || 0) + 1;
    return frame;
  }

  emitFrame() {
    if (this.destroyed || this.stopping || this.blocked) return;
    const frame = this.takeFrame();
    const accepted = this.push(frame);
    if (!accepted) this.blocked = true;
    this.proc.outputFrames = (this.proc.outputFrames || 0) + 1;
  }

  finishInput() {
    if (this.destroyed || this.stopping) return;
    this.explicitlyFinished = true;
    this.stopping = true;
    clearInterval(this.timer);
    // Any buffered tail is intentionally discarded on explicit stop; no audio is persisted.
    this.queue.length = 0;
    this.queueHeadOffset = 0;
    this.queuedBytes = 0;
    this.push(null);
  }

  _destroy(err, callback) {
    this.stopping = true;
    clearInterval(this.timer);
    this.queue.length = 0;
    this.queuedBytes = 0;
    callback(err);
  }
}

/** Child-process-shaped adapter used by the existing live voice lifecycle. */
function createLivePcmAudioProcess() {
  const proc = new EventEmitter();
  let finalized = false;
  proc.exitCode = null;
  proc.killed = false;
  proc.rawPcm = true;
  proc.liveInputBytes = 0;
  proc.outputFrames = 0;
  proc.underrunFrames = 0;
  proc.droppedInputBytes = 0;
  proc.failureReason = "";
  proc.startedAt = Date.now();
  proc.lastInputAt = proc.startedAt;
  proc.stdout = new ClockedPcmReadable(proc);

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
    highWaterMark: MAX_QUEUED_PCM_BYTES,
    write(chunk, encoding, callback) {
      if (finalized || proc.stdout.destroyed || proc.stdout.stopping) {
        const err = new Error("PCM output stream is no longer writable");
        err.code = "ERR_LIVE_PCM_OUTPUT_CLOSED";
        callback(err);
        return;
      }
      if (!Buffer.isBuffer(chunk) || chunk.length === 0 || chunk.length % 4 !== 0) {
        const err = new Error("PCM input must contain complete stereo s16le samples");
        err.code = "ERR_LIVE_PCM_INVALID_FRAME";
        proc.failureReason = err.message;
        callback(err);
        return;
      }
      proc.liveInputBytes += chunk.length;
      proc.lastInputAt = Date.now();
      try {
        proc.stdout.enqueue(chunk);
        callback();
      } catch (err) {
        callback(err);
      }
    },
    final(callback) {
      proc.stdout.finishInput();
      callback();
    },
  });
  proc.stdin = stdin;

  stdin.once("finish", () => finish(0));
  stdin.on("error", err => {
    const earlierFailure = proc.failureReason;
    const isSecondaryPrematureClose = Boolean(earlierFailure) &&
      (err?.code === "ERR_STREAM_PREMATURE_CLOSE" || /premature close/i.test(String(err?.message || "")));
    if (!proc.failureReason) {
      proc.failureReason = `microphone input write failed: ${err?.code || err?.message || "unknown error"}`;
    }
    finish(1, proc.failureReason);
    if (!proc.stdout.destroyed) proc.stdout.destroy();
    if (!isSecondaryPrematureClose) proc.emit("error", err);
  });
  stdin.once("close", () => {
    if (!finalized && !stdin.writableEnded) finish(1, "microphone input closed before normal end");
  });
  proc.stdout.once("close", () => {
    if (!proc.stdout.explicitlyFinished && !finalized) {
      const reason = "Discord audio consumer closed the clocked PCM output while microphone session was active";
      proc.failureReason = reason;
      finish(1, reason);
      if (!stdin.destroyed) stdin.destroy();
      const err = new Error(reason);
      err.code = "ERR_LIVE_PCM_DOWNSTREAM_CLOSED";
      proc.emit("error", err);
    }
  });
  proc.stdout.on("error", err => {
    proc.failureReason = `Discord audio output failed: ${err?.code || err?.message || "unknown error"}`;
    finish(1, proc.failureReason);
    if (!stdin.destroyed) stdin.destroy();
    proc.emit("error", err);
  });

  proc.kill = () => {
    if (proc.exitCode !== null) return false;
    proc.killed = true;
    proc.failureReason = "live PCM pipeline was stopped";
    if (!proc.stdout.destroyed) proc.stdout.finishInput();
    if (!stdin.destroyed) stdin.destroy();
    finish(1, proc.failureReason);
    return true;
  };

  process.nextTick(() => proc.emit("spawn"));
  return proc;
}

module.exports = { createLivePcmAudioProcess, PCM_FRAME_BYTES, PCM_FRAME_MS, MAX_QUEUED_PCM_BYTES };
