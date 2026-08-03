/** Document text extraction — PDF, DOCX, plain text/code. Photo/binary noise stripped. */

import { log } from "../core/log.js";

export function clean(raw) {
  return String(raw)
    .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]+/gi, " ")
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, " ")
    .replace(/\/(XObject|Subtype\s*\/Image|Filter\s*\/DCTDecode|ColorSpace)[^\n]*/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g, "")
    .replace(/[ \t]{3,}/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const isPdf = (buf) => buf.length > 4 && buf.subarray(0, 4).toString("latin1") === "%PDF";
const isZip = (buf) => buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b;

async function readPdf(buffer) {
  // Import the library entry directly: pdf-parse's index.js runs a debug branch
  // that reads ./test/data/*.pdf when it is loaded as an ESM module, which
  // throws ENOENT before our buffer is ever parsed.
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default ?? mod;
  const out = await pdfParse(buffer);
  return clean(out?.text ?? "");
}

async function readDocx(buffer) {
  const mammoth = await import("mammoth");
  const lib = mammoth.default ?? mammoth;
  const out = await lib.extractRawText({ buffer });
  return clean(out?.value ?? "");
}

/**
 * Extract readable text from an uploaded file.
 * Detection is content-sniffing first (magic bytes), then name/mime, so a
 * mislabelled upload still parses correctly.
 */
export async function extractText(file) {
  const name = (file.originalname ?? file.name ?? "").toLowerCase();
  const mime = file.mimetype ?? "";
  const buffer = file.buffer;

  if (!buffer?.length) throw new Error("Uploaded file is empty.");

  try {
    if (isPdf(buffer) || name.endsWith(".pdf") || mime === "application/pdf") {
      const text = await readPdf(buffer);
      if (!text) throw new Error("This PDF has no selectable text (it is likely a scan).");
      log.info("documents", `pdf parsed ${name || "file"} → ${text.length} chars`);
      return text;
    }

    if (
      name.endsWith(".docx") ||
      mime.includes("wordprocessingml") ||
      (isZip(buffer) && !name.endsWith(".zip"))
    ) {
      const text = await readDocx(buffer);
      if (!text) throw new Error("No readable text found in this document.");
      log.info("documents", `docx parsed ${name || "file"} → ${text.length} chars`);
      return text;
    }

    const text = clean(buffer.toString("utf8"));
    if (!text) throw new Error("No readable text found in this file.");
    log.info("documents", `text parsed ${name || "file"} → ${text.length} chars`);
    return text;
  } catch (err) {
    log.error("documents", `extraction failed for ${name || "file"}`, err.message);
    throw Object.assign(new Error(`Could not read "${name || "file"}": ${err.message}`), {
      status: 422,
    });
  }
}
