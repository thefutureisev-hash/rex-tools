import { useState } from 'react';
import type { QuotePdfData } from '../../shared/quotePdf';
import { makeQuotePdf, pdfFileName, saveFile } from '../pdf';

export function GeneratePdfButton({ build, project, disabled }: { build: () => QuotePdfData | null; project: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="pdf-action">
      <button
        type="button"
        className="primary"
        disabled={disabled || busy}
        onClick={async () => {
          const data = build();
          if (!data) return;
          setBusy(true);
          setError('');
          try {
            saveFile(await makeQuotePdf(data), pdfFileName(project));
          } catch (e) {
            setError((e as Error).message || 'Could not create the PDF.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Creating PDF…' : 'Generate quote PDF'}
      </button>
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
