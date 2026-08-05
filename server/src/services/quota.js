/**
 * Daily image-generation quota — backend enforced, per Firebase user.
 *
 * Storage: Firestore (collection IMAGE_QUOTA_COLLECTION, default
 * "image_quota", document id = Firebase UID). If firebase-admin cannot be
 * initialised (no credentials in the environment) the counter falls back to
 * an in-process store so the limit is still enforced server side.
 *
 * Configure with:
 *   DAILY_IMAGE_LIMIT=3
 *   FIREBASE_SERVICE_ACCOUNT={...json...}        (or)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json
 *   FIREBASE_PROJECT_ID=chatbot-d73e2
 */

import { log } from "../core/log.js";

export const DAILY_IMAGE_LIMIT = Number(process.env.DAILY_IMAGE_LIMIT ?? 3);
const COLLECTION = process.env.IMAGE_QUOTA_COLLECTION ?? "image_quota";

const memory = new Map(); // uid -> { day, count }
let adminPromise;

const today = () => new Date().toISOString().slice(0, 10); // UTC day, auto resets

async function admin() {
  if (adminPromise) return adminPromise;
  adminPromise = (async () => {
    try {
      const mod = await import("firebase-admin");
      const fb = mod.default ?? mod;
      if (!fb.apps.length) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (raw) {
          const json = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
          fb.initializeApp({ credential: fb.credential.cert(json), projectId: json.project_id });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_PROJECT_ID) {
          fb.initializeApp({
            credential: fb.credential.applicationDefault(),
            ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
          });
        } else {
          return null;
        }
      }
      return fb;
    } catch (err) {
      log.warn("quota", "firebase-admin unavailable, using in-memory quota", err.message);
      return null;
    }
  })();
  return adminPromise;
}

/** Resolve the caller's Firebase UID from a bearer ID token or an explicit uid. */
export async function resolveUid(req) {
  const header = req.headers?.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) {
    const fb = await admin();
    if (fb) {
      try {
        const decoded = await fb.auth().verifyIdToken(token);
        return decoded.uid;
      } catch (err) {
        log.warn("quota", "id token verification failed", err.message);
      }
    }
  }
  const uid = req.body?.uid ?? req.body?.userId ?? req.headers?.["x-user-uid"];
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

async function readCount(uid, day) {
  const fb = await admin();
  if (!fb) {
    const rec = memory.get(uid);
    return rec && rec.day === day ? rec.count : 0;
  }
  const snap = await fb.firestore().collection(COLLECTION).doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  return data && data.day === day ? Number(data.count ?? 0) : 0;
}

async function writeCount(uid, day, count) {
  const fb = await admin();
  if (!fb) {
    memory.set(uid, { day, count });
    return;
  }
  await fb
    .firestore()
    .collection(COLLECTION)
    .doc(uid)
    .set({ day, count, updatedAt: new Date().toISOString() }, { merge: true });
}

export const LIMIT_MESSAGE = `You have reached today's free image generation limit (${DAILY_IMAGE_LIMIT}/${DAILY_IMAGE_LIMIT}). Please try again tomorrow.`;

/** Throws a 429-style error when the daily quota is exhausted. */
export async function assertImageQuota(uid) {
  if (!uid) return { uid: null, used: 0, remaining: DAILY_IMAGE_LIMIT, enforced: false };
  const day = today();
  const used = await readCount(uid, day);
  if (used >= DAILY_IMAGE_LIMIT) {
    throw Object.assign(new Error(LIMIT_MESSAGE), {
      status: 429,
      limit: DAILY_IMAGE_LIMIT,
      used,
      remaining: 0,
    });
  }
  return { uid, day, used, remaining: DAILY_IMAGE_LIMIT - used, enforced: true };
}

/** Count one successful generation and return the remaining allowance. */
export async function consumeImageQuota(uid) {
  if (!uid) return { limit: DAILY_IMAGE_LIMIT, used: 0, remaining: DAILY_IMAGE_LIMIT, enforced: false };
  const day = today();
  const used = (await readCount(uid, day)) + 1;
  await writeCount(uid, day, used);
  return {
    limit: DAILY_IMAGE_LIMIT,
    used,
    remaining: Math.max(0, DAILY_IMAGE_LIMIT - used),
    enforced: true,
  };
}
