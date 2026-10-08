const TEXT_EXTS = ["txt", "md", "markdown", "csv", "json", "log", "xml", "html", "htm"];
const MAX_CHARS = 2_000_000;

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((it: any) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
        .join("")
    );
  }
  return pages.join("\n\n");
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const m: any = await import("mammoth");
  const extract = m.extractRawText ?? m.default?.extractRawText;
  const result = await extract({ arrayBuffer: buf });
  return result.value as string;
}

export async function extractText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  let text: string;

  if (ext === "pdf") text = await pdfText(await file.arrayBuffer());
  else if (ext === "docx") text = await docxText(await file.arrayBuffer());
  else if (TEXT_EXTS.includes(ext)) text = await file.text();
  else throw new Error("unsupported file type (use PDF, DOCX, TXT, MD, CSV or JSON)");

  return text.slice(0, MAX_CHARS);
}

export function chunkText(text: string, size = 900, overlap = 120): string[] {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };

  for (const para of clean.split(/\n\s*\n/)) {
    if (cur && (cur + "\n\n" + para).length <= size) {
      cur += "\n\n" + para;
      continue;
    }
    flush();
    if (para.length <= size) {
      cur = para;
      continue;
    }
    // long paragraph: cut into overlapping windows, preferring to break at a space
    let i = 0;
    while (i < para.length) {
      let end = Math.min(i + size, para.length);
      if (end < para.length) {
        const sp = para.lastIndexOf(" ", end);
        if (sp > i + size * 0.6) end = sp;
      }
      const piece = para.slice(i, end).trim();
      if (piece) chunks.push(piece);
      if (end >= para.length) break;
      i = Math.max(end - overlap, i + 1);
    }
  }
  flush();
  return chunks;
}