interface PrintOptions {
  title: string;
  styles?: string;
}
const PRINT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; font-src https:; script-src 'unsafe-inline';">`;

const AUTO_PRINT_SCRIPT = `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>`;

export const LETTER_STYLES = `
  body {
    font-family: 'Times New Roman', Times, serif;
    max-width: 7.5in;
    margin: 0 auto;
    padding: 0;
    line-height: 1.6;
    color: #000;
  }
  .tmpl-violation-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 4px 0;
  }
  .tmpl-checkbox {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    min-width: 14px;
    border: 1.5px solid #000;
    margin-top: 4px;
    box-sizing: border-box;
  }
  .tmpl-checkbox.tmpl-checked::before {
    content: '\\2713';
    font-size: 12px;
    line-height: 1;
  }
  @media print {
    body { margin: 0; }
    @page { size: letter; margin: 0.5in; }
  }
`;

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[\s>][^]*$/gi, '')
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
}

function openPrintWindow(html: string): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    console.error('Failed to open print window — popup blocker may be active.');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}

export function printFullHtml(fullHtml: string): void {
  let html = fullHtml;
  if (!html.includes('Content-Security-Policy')) {
    html = html.replace('<head>', `<head>${PRINT_CSP}`);
  }
  html = html.replace('</body>', `${AUTO_PRINT_SCRIPT}</body>`);
  openPrintWindow(html);
}

export function printHtmlContent(content: string, options: PrintOptions): void {
  const { title, styles = '' } = options;
  const html = `<!DOCTYPE html>
<html>
<head>
  ${PRINT_CSP}
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1a1a1a;
      line-height: 1.5;
      padding: 0.6in 0.75in;
    }
    @media print {
      body { padding: 0; margin: 0.5in 0.6in; }
      @page { size: letter; margin: 0.5in 0.6in; }
    }
    ${styles}
  </style>
</head>
<body>
  ${content}
  ${AUTO_PRINT_SCRIPT}
</body>
</html>`;
  openPrintWindow(html);
}

export function printLetterHtml(bodyHtml: string): void {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${PRINT_CSP}
  <style>${LETTER_STYLES}</style>
</head>
<body>${sanitizeHtml(bodyHtml)}</body>
</html>`;
  printFullHtml(html);
}
