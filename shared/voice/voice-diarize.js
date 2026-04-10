/**************************************************************/
/* filename: "voice-diarize.js"                              */
/* Version 1.0                                               */
/* Purpose: Shared helpers for voice diarization persistence */
/*          and preamble construction.                       */
/**************************************************************/

import fs           from "node:fs";
import path         from "node:path";
import mysql        from "mysql2/promise";
import ffmpegImport from "fluent-ffmpeg";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH   || "/usr/bin/ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || "/usr/bin/ffprobe");

const SILENCE_S = 2;

let _pool = null;
let _poolDsn = "";


function getDsnKey(db) {
  return `${db.host}|${db.port ?? 3306}|${db.user}|${db.database}`;
}


export async function getEnsureDiarizePool(wo) {
  const db = wo?.db;
  if (!db) throw new Error("[voice-diarize] missing db config");
  const key = getDsnKey(db);
  if (_pool && _poolDsn === key) return _pool;
  _pool = mysql.createPool({
    host: db.host,
    port: db.port ?? 3306,
    user: db.user,
    password: db.password,
    database: db.database,
    charset: db.charset || "utf8mb4",
    waitForConnections: true,
    connectionLimit: 5
  });
  _poolDsn = key;
  return _pool;
}


export async function ensureDiarizeTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS voice_speakers (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    channel_id       VARCHAR(64)  NOT NULL,
    name             VARCHAR(128) NOT NULL,
    sample_audio_path VARCHAR(512),
    sample_text      TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vs_channel (channel_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS voice_sessions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    channel_id VARCHAR(64) NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vss_channel (channel_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS voice_chunks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    session_id  INT NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    transcript  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vc_session (session_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS voice_chunk_speakers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    chunk_id    INT         NOT NULL,
    chunk_label VARCHAR(32) NOT NULL,
    speaker_id  INT,
    UNIQUE KEY uniq_vcs_chunk_label (chunk_id, chunk_label),
    INDEX idx_vcs_chunk (chunk_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}


export async function listSpeakers(pool, channelId) {
  const [rows] = await pool.query(
    `SELECT id,
            channel_id AS channelId,
            name,
            sample_text AS sampleText,
            sample_audio_path AS sampleAudioPath,
            created_at AS createdAt
     FROM voice_speakers WHERE channel_id = ? ORDER BY name`,
    [channelId]
  );
  return rows;
}


export async function getSpeaker(pool, id) {
  const [rows] = await pool.query(
    `SELECT id,
            channel_id AS channelId,
            name,
            sample_text AS sampleText,
            sample_audio_path AS sampleAudioPath
     FROM voice_speakers WHERE id = ?`,
    [id]
  );
  return rows[0] ?? null;
}


export async function createSpeaker(pool, { channelId, name }) {
  const [r] = await pool.query(
    "INSERT INTO voice_speakers (channel_id, name) VALUES (?, ?)",
    [channelId, name]
  );
  return r.insertId;
}


export async function updateSpeakerSample(pool, id, { sampleAudioPath, sampleText }) {
  await pool.query(
    "UPDATE voice_speakers SET sample_audio_path = ?, sample_text = ? WHERE id = ?",
    [sampleAudioPath, sampleText, id]
  );
}


export async function deleteSpeaker(pool, id) {
  const sp = await getSpeaker(pool, id);
  if (sp?.sampleAudioPath) {
    try { await fs.promises.unlink(sp.sampleAudioPath); } catch {}
  }
  await pool.query("DELETE FROM voice_speakers WHERE id = ?", [id]);
}


export async function getSession(pool, sessionId) {
  const [rows] = await pool.query(
    `SELECT id,
            channel_id AS channelId,
            started_at AS startedAt
       FROM voice_sessions WHERE id = ?`,
    [sessionId]
  );
  return rows[0] ?? null;
}


export async function createSession(pool, channelId) {
  const [r] = await pool.query(
    "INSERT INTO voice_sessions (channel_id) VALUES (?)",
    [channelId]
  );
  return r.insertId;
}


export async function listSessions(pool, channelId) {
  const [rows] = await pool.query(
    `SELECT id,
            channel_id AS channelId,
            started_at AS startedAt
     FROM voice_sessions WHERE channel_id = ? ORDER BY started_at DESC LIMIT 50`,
    [channelId]
  );
  return rows;
}


export async function deleteSession(pool, sessionId) {
  const [chunks] = await pool.query(
    "SELECT id FROM voice_chunks WHERE session_id = ?",
    [sessionId]
  );
  for (const chunk of chunks) {
    await pool.query("DELETE FROM voice_chunk_speakers WHERE chunk_id = ?", [chunk.id]);
  }
  await pool.query("DELETE FROM voice_chunks WHERE session_id = ?", [sessionId]);
  await pool.query("DELETE FROM voice_sessions WHERE id = ?", [sessionId]);
}


export async function createChunk(pool, { sessionId, chunkIndex, transcript }) {
  const [r] = await pool.query(
    "INSERT INTO voice_chunks (session_id, chunk_index, transcript) VALUES (?, ?, ?)",
    [sessionId, chunkIndex, transcript]
  );
  return r.insertId;
}


export async function upsertChunkSpeaker(pool, { chunkId, chunkLabel, speakerId }) {
  await pool.query(
    `INSERT INTO voice_chunk_speakers (chunk_id, chunk_label, speaker_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE speaker_id = VALUES(speaker_id)`,
    [chunkId, chunkLabel, speakerId ?? null]
  );
}


export async function listChunksForSession(pool, sessionId) {
  const [chunks] = await pool.query(
    `SELECT id,
            chunk_index AS chunkIndex,
            transcript,
            created_at AS createdAt
     FROM voice_chunks WHERE session_id = ? ORDER BY chunk_index`,
    [sessionId]
  );
  for (const chunk of chunks) {
    const [mappings] = await pool.query(
      `SELECT vcs.chunk_label AS chunkLabel,
              vcs.speaker_id AS speakerId,
              vs.name AS speakerName
       FROM voice_chunk_speakers vcs
       LEFT JOIN voice_speakers vs ON vs.id = vcs.speaker_id
       WHERE vcs.chunk_id = ?`,
      [chunk.id]
    );
    chunk.speakers = mappings;
  }
  return chunks;
}


function getFileDurationS(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      const d = meta?.format?.duration;
      if (!Number.isFinite(d) || d <= 0) return reject(new Error("ffprobe: no duration for " + filePath));
      resolve(d);
    });
  });
}


function makeSilenceWav(outFile) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * SILENCE_S * channels;
  const dataSize = numSamples * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize, 0);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return fs.promises.writeFile(outFile, buf);
}


function concatWavFiles(files, outFile) {
  return new Promise((resolve, reject) => {
    const listFile = outFile + ".list";
    const content = files.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join("\n");
    fs.writeFileSync(listFile, content, "utf-8");
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .save(outFile)
      .on("end", () => { try { fs.unlinkSync(listFile); } catch {} resolve(); })
      .on("error", reject);
  });
}


export async function buildSamplePreamble(speakers, tmpDir) {
  const withSamples = speakers.filter(s => s.sampleAudioPath);
  if (!withSamples.length) return null;

  const silenceFile = path.join(tmpDir, "preamble_silence.wav");
  await makeSilenceWav(silenceFile);

  const files = [];
  const orderedSpeakerIds = [];
  let preambleDurationS = 0;

  for (const sp of withSamples) {
    const dur = await getFileDurationS(sp.sampleAudioPath);
    files.push(sp.sampleAudioPath, silenceFile);
    orderedSpeakerIds.push(sp.id);
    preambleDurationS += dur + SILENCE_S;
  }

  return { files, orderedSpeakerIds, preambleDurationS };
}


export async function concatPreambleWithAudio(preamble, audioFile, outFile) {
  await concatWavFiles([...preamble.files, audioFile], outFile);
}


function normalizeSampleText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function getTokenSet(text) {
  return new Set(normalizeSampleText(text).split(" ").filter(Boolean));
}


function getTextOverlapScore(a, b) {
  const normA = normalizeSampleText(a);
  const normB = normalizeSampleText(b);
  if (!normA || !normB) return 0;
  if (normA.includes(normB) || normB.includes(normA)) return 1;

  const setA = getTokenSet(normA);
  const setB = getTokenSet(normB);
  if (!setA.size || !setB.size) return 0;

  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared++;
  }
  return shared / Math.max(1, Math.min(setA.size, setB.size));
}


function getTextMatchedLabelMap(segments, speakers) {
  const entries = [];
  for (const speaker of speakers || []) {
    const sampleText = String(speaker?.sampleText || "").trim();
    if (!sampleText) continue;
    for (const seg of segments || []) {
      const segText = String(seg?.text || "").trim();
      const segLabel = String(seg?.speaker || "").trim();
      if (!segText || !segLabel) continue;
      const score = getTextOverlapScore(segText, sampleText);
      if (score >= 0.72) {
        entries.push({ speakerId: speaker.id, label: segLabel, score });
      }
    }
  }

  entries.sort((a, b) => b.score - a.score);
  const labelMap = {};
  const usedIds = new Set();
  for (const entry of entries) {
    if (labelMap[entry.label] != null) continue;
    if (usedIds.has(entry.speakerId)) continue;
    labelMap[entry.label] = entry.speakerId;
    usedIds.add(entry.speakerId);
  }
  return labelMap;
}


export function resolveSpeakerMapping(segments, preambleDurationS, orderedSpeakerIds, speakers = []) {
  const preambleSegs = segments.filter(s => (s.start ?? 0) < preambleDurationS);
  let cleanSegs = segments.filter(s => (s.start ?? 0) >= preambleDurationS);

  const labelOrder = [];
  for (const seg of preambleSegs) {
    if (seg.speaker && !labelOrder.includes(seg.speaker)) labelOrder.push(seg.speaker);
  }

  const mapping = {};
  for (let i = 0; i < labelOrder.length && i < orderedSpeakerIds.length; i++) {
    mapping[labelOrder[i]] = orderedSpeakerIds[i];
  }

  const textMatchedMap = getTextMatchedLabelMap(segments, speakers);
  for (const [label, speakerId] of Object.entries(textMatchedMap)) {
    if (mapping[label] == null) mapping[label] = speakerId;
  }

  if (!cleanSegs.length && Object.keys(textMatchedMap).length) {
    cleanSegs = segments.filter(seg => textMatchedMap[String(seg?.speaker || "").trim()] == null);
  }

  const zeroOffsetFallback = !cleanSegs.length && !!segments.length && Object.keys(mapping).length === 1;
  if (zeroOffsetFallback) cleanSegs = segments.slice();

  return {
    mapping,
    cleanSegments: cleanSegs,
    textMatchedMap,
    zeroOffsetFallback
  };
}
