import bold from 'roboto-fontface/fonts/roboto/Roboto-Bold.woff?inline';
import medium from 'roboto-fontface/fonts/roboto/Roboto-Medium.woff?inline';
import regular from 'roboto-fontface/fonts/roboto/Roboto-Regular.woff?inline';
import { buildQuotePdf, type QuotePdfData } from '../shared/quotePdf';

/** Builds the quote PDF in the browser and saves it. */

const fromDataUri = (uri: string) => Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));

let template: Uint8Array | null = null;
async function loadTemplate(): Promise<Uint8Array> {
  if (template) return template;
  if (__STATIC__) {
    // The test page publishes the template as a file next to it
    const r = await fetch('solar-quote-template.pdf');
    if (!r.ok) throw new Error('Could not load the quotation template.');
    template = new Uint8Array(await r.arrayBuffer());
  } else {
    const r = await fetch('/api/template/solar');
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Could not load the quotation template.');
    template = new Uint8Array(await r.arrayBuffer());
  }
  return template;
}

export async function makeQuotePdf(data: QuotePdfData): Promise<Blob> {
  const bytes = await buildQuotePdf(data, {
    template: await loadTemplate(),
    regular: fromDataUri(regular),
    medium: fromDataUri(medium),
    bold: fromDataUri(bold),
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export const pdfFileName = (project: string, date = new Date()) =>
  `REX Quotation - ${(project || 'Solar PV').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${date.toISOString().slice(0, 10)}.pdf`;

interface ClaudeViewer { use(name: string): Promise<unknown> }
interface Downloads { save(r: { filename: string; data: Blob }): Promise<unknown> }

/**
 * Saves the file. Inside the claude.ai viewer (the test page) browser downloads are blocked,
 * so the viewer's downloads capability asks the person to confirm instead.
 */
export async function saveFile(blob: Blob, name: string) {
  const viewer = (window as unknown as { claude?: ClaudeViewer }).claude;
  if (viewer?.use) {
    const downloads = (await viewer.use('downloads')) as Downloads | null;
    if (downloads) {
      try {
        await downloads.save({ filename: name, data: blob });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'declined') return;
        throw new Error((e as { message?: string }).message || 'The PDF could not be saved here.');
      }
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
