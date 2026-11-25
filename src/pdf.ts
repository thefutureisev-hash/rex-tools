import bold from 'roboto-fontface/fonts/roboto/Roboto-Bold.woff?inline';
import medium from 'roboto-fontface/fonts/roboto/Roboto-Medium.woff?inline';
import regular from 'roboto-fontface/fonts/roboto/Roboto-Regular.woff?inline';
import { buildQuotePdf, type QuotePdfData } from '../shared/quotePdf';

/** Builds the quote PDF in the browser and saves it. */

const fromDataUri = (uri: string) => Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));

// In the self-contained test build the template is compiled in
const staticTemplate = __STATIC__
  ? Object.values(import.meta.glob<{ b64: string }>('./static-template.json', { eager: true, import: 'default' }))[0]
  : undefined;

let template: Uint8Array | null = null;
async function loadTemplate(): Promise<Uint8Array> {
  if (template) return template;
  if (staticTemplate) {
    template = Uint8Array.from(atob(staticTemplate.b64), (c) => c.charCodeAt(0));
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

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
