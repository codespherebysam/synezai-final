/** Document text extraction — PDF, DOCX, plain text/code. Photo/binary noise stripped. */

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

export async function extractText(file) {
  const name = (file.originalname ?? "").toLowerCase();
  const mime = file.mimetype ?? "";

  if (name.endsWith(".pdf") || mime === "application/pdf") {
    const { default: pdfParse } = await import("pdf-parse");
    const out = await pdfParse(file.buffer);
    return clean(out.text ?? "");
  }
  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const out = await mammoth.extractRawText({ buffer: file.buffer });
    return clean(out.value ?? "");
  }
  return clean(file.buffer.toString("utf8"));
}
