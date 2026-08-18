import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeHtml, sanitizeHtml, printHtmlContent, printFullHtml, printLetterHtml } from '../print-service';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('preserves quotes (textContent/innerHTML does not escape them)', () => {
    expect(escapeHtml('"hello"')).toBe('"hello"');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through safe text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });

  it('strips inline event handlers', () => {
    expect(sanitizeHtml('<div onclick="alert(1)">hi</div>')).toBe('<div >hi</div>');
  });

  it('strips unclosed script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)')).toBe('<p>ok</p>');
  });

  it('preserves safe HTML', () => {
    const safe = '<p><strong>Hello</strong></p>';
    expect(sanitizeHtml(safe)).toBe(safe);
  });
});

describe('print functions', () => {
  let mockWindow: { document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    mockWindow = {
      document: { write: vi.fn(), close: vi.fn() },
    };
  });

  describe('printHtmlContent', () => {
    it('writes report-style HTML to the new window', () => {
      vi.spyOn(window, 'open').mockReturnValue(mockWindow as any);
      printHtmlContent('<p>test</p>', { title: 'Report' });

      expect(window.open).toHaveBeenCalledWith('', '_blank');
      expect(mockWindow.document.write).toHaveBeenCalledOnce();
      const html = mockWindow.document.write.mock.calls[0]![0] as string;
      expect(html).toContain('<title>Report</title>');
      expect(html).toContain('<p>test</p>');
      expect(html).toContain('Content-Security-Policy');
      expect(mockWindow.document.close).toHaveBeenCalledOnce();
    });

    it('includes custom styles when provided', () => {
      vi.spyOn(window, 'open').mockReturnValue(mockWindow as any);
      printHtmlContent('<p>test</p>', { title: 'T', styles: '.custom { color: red; }' });

      const html = mockWindow.document.write.mock.calls[0]![0] as string;
      expect(html).toContain('.custom { color: red; }');
    });
  });

  describe('printFullHtml', () => {
    it('injects CSP and auto-print script', () => {
      vi.spyOn(window, 'open').mockReturnValue(mockWindow as any);
      printFullHtml('<html><head></head><body><p>hi</p></body></html>');

      const html = mockWindow.document.write.mock.calls[0]![0] as string;
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain('window.print()');
    });

    it('does not duplicate CSP if already present', () => {
      vi.spyOn(window, 'open').mockReturnValue(mockWindow as any);
      const input = '<html><head><meta http-equiv="Content-Security-Policy" content="test"></head><body></body></html>';
      printFullHtml(input);

      const html = mockWindow.document.write.mock.calls[0]![0] as string;
      const cspCount = (html.match(/Content-Security-Policy/g) || []).length;
      expect(cspCount).toBe(1);
    });
  });

  describe('printLetterHtml', () => {
    it('sanitizes content and uses letter styles', () => {
      vi.spyOn(window, 'open').mockReturnValue(mockWindow as any);
      printLetterHtml('<p>ok</p><script>xss</script>');

      const html = mockWindow.document.write.mock.calls[0]![0] as string;
      expect(html).toContain('<p>ok</p>');
      expect(html).not.toContain('<script>xss</script>');
      expect(html).toContain('Times New Roman');
    });
  });

  it('handles popup blocker gracefully', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    printHtmlContent('<p>test</p>', { title: 'T' });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('popup blocker'));
    spy.mockRestore();
  });
});
