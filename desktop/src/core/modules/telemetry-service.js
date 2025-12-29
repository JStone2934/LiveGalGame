import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DIRNAME = 'telemetry';
const DEFAULT_FILENAME = 'training-signals.jsonl';
const MAX_RECORD_BYTES = 512 * 1024;

export default class TelemetryService {
  constructor(options = {}) {
    const baseDir = options.baseDir || this.resolveBaseDir();
    this.baseDir = baseDir;
    this.fileName = options.fileName || DEFAULT_FILENAME;
    this.maxRecordBytes = Number.isFinite(options.maxRecordBytes)
      ? options.maxRecordBytes
      : MAX_RECORD_BYTES;
  }

  resolveBaseDir() {
    try {
      const userDataDir = app?.getPath ? app.getPath('userData') : null;
      if (!userDataDir) return null;
      return path.join(userDataDir, DEFAULT_DIRNAME);
    } catch (error) {
      console.warn('[TelemetryService] Failed to resolve userData dir:', error);
      return null;
    }
  }

  get enabled() {
    return Boolean(this.baseDir);
  }

  get filePath() {
    if (!this.enabled) return null;
    return path.join(this.baseDir, this.fileName);
  }

  normalizePayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (Array.isArray(payload)) return { items: payload };
    return payload;
  }

  async appendEvent(payload = {}) {
    if (!this.enabled) return { success: false, disabled: true };

    const normalized = this.normalizePayload(payload);
    if (!normalized) return { success: false, error: 'invalid_payload' };

    const record = {
      ...normalized,
      recorded_at: Date.now()
    };

    let line = '';
    try {
      line = `${JSON.stringify(record)}\n`;
    } catch (error) {
      return { success: false, error: 'stringify_failed' };
    }

    if (this.maxRecordBytes && line.length > this.maxRecordBytes) {
      return { success: false, error: 'payload_too_large' };
    }

    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.filePath, line, 'utf8');
    return { success: true, path: this.filePath };
  }
}
