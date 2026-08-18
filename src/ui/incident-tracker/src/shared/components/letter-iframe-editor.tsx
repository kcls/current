import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Box, Typography, IconButton, Divider, Tooltip } from '@mui/material';
import {
  FormatBold,
  FormatItalic,
  FormatUnderlined,
  Undo,
  Redo,
} from '@mui/icons-material';
import { LETTER_STYLES } from '../utils/print-service';

export interface LetterIframeEditorProps {
  htmlContent: string;
  onContentEdited?: (content: string) => void;
  readOnly?: boolean;
  height?: number | string;
  initialCheckedReasons?: string[];
  toolbarExtra?: React.ReactNode;
  error?: boolean;
}

export interface LetterIframeEditorRef {
  getContent: () => string;
  getFullHtml: () => string;
  getCheckedReasons: () => string[];
  updateTemplateVars: (vars: Record<string, string>) => void;
  syncContent: () => string;
  flashViolations: () => void;
}

const EDITOR_CSS = LETTER_STYLES + `
  body { background: #fff; }
  .tmpl-violation-item { cursor: pointer; }
  @keyframes tmpl-violation-nudge {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-5px); }
    40% { transform: translateX(5px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(3px); }
  }
  body.tmpl-violations-attention .tmpl-violation-list {
    animation: tmpl-violation-nudge 0.4s ease;
    outline: 2px solid #d32f2f;
    outline-offset: 4px;
  }
`;

const VIOLATION_ATTENTION_MS = 2000;

const wrapInDocument = (bodyHtml: string): string =>
  `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${EDITOR_CSS}</style></head>
<body>${bodyHtml}</body>
</html>`;

type FormatCommand = 'bold' | 'italic' | 'underline' | 'undo' | 'redo';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

const TOOLBAR_BUTTONS: { command: FormatCommand; icon: React.ReactNode; label: string; hasDividerBefore?: boolean }[] = [
  { command: 'bold', icon: <FormatBold fontSize="small" />, label: `Bold (${mod}B)` },
  { command: 'italic', icon: <FormatItalic fontSize="small" />, label: `Italic (${mod}I)` },
  { command: 'underline', icon: <FormatUnderlined fontSize="small" />, label: `Underline (${mod}U)` },
  { command: 'undo', icon: <Undo fontSize="small" />, label: `Undo (${mod}Z)`, hasDividerBefore: true },
  { command: 'redo', icon: <Redo fontSize="small" />, label: `Redo (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})` },
];

export const LetterIframeEditor = forwardRef<LetterIframeEditorRef, LetterIframeEditorProps>(
  ({ htmlContent, onContentEdited, readOnly = false, height = 600, initialCheckedReasons, toolbarExtra, error = false }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const attentionTimerRef = useRef<number | null>(null);
    const callbackRef = useRef(onContentEdited);
    callbackRef.current = onContentEdited;
    const initialChecksRef = useRef(initialCheckedReasons);
    initialChecksRef.current = initialCheckedReasons;
    // Tracks content from user edits so we can skip re-writing the iframe
    // when the parent syncs that same content back via the htmlContent prop.
    const dirtyContentRef = useRef<string | null>(null);

    const [activeFormats, setActiveFormats] = useState<Set<FormatCommand>>(new Set());

    const getDoc = useCallback(
      () => iframeRef.current?.contentDocument ?? null,
      [],
    );

    const execCommand = useCallback((command: FormatCommand) => {
      const doc = getDoc();
      if (!doc) return;
      doc.execCommand(command, false);
      iframeRef.current?.contentWindow?.focus();
      const content = doc.body?.innerHTML ?? '';
      dirtyContentRef.current = content;
      callbackRef.current?.(content);
    }, [getDoc]);

    const updateActiveFormats = useCallback(() => {
      const doc = getDoc();
      if (!doc) return;

      const bold = doc.queryCommandState('bold');
      const italic = doc.queryCommandState('italic');
      const underline = doc.queryCommandState('underline');

      setActiveFormats((prev) => {
        if (
          prev.has('bold') === bold &&
          prev.has('italic') === italic &&
          prev.has('underline') === underline
        ) {
          return prev;
        }
        const next = new Set<FormatCommand>();
        if (bold) next.add('bold');
        if (italic) next.add('italic');
        if (underline) next.add('underline');
        return next;
      });
    }, [getDoc]);

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe || !htmlContent) return;

      const doc = iframe.contentDocument;
      if (!doc) return;

      if (htmlContent !== dirtyContentRef.current) {
        dirtyContentRef.current = null;

        // Turn off designMode before rewriting to prevent spurious input events
        // from stale listeners surviving doc.open()
        doc.designMode = 'off';

        // Preserve scroll position — doc.open()/write()/close() can cause the
        // browser to jump to the top of the page.
        const scrollY = window.scrollY;
        doc.open();
        doc.write(wrapInDocument(htmlContent));
        doc.close();
        window.scrollTo(0, scrollY);

        const checks = initialChecksRef.current;
        if (checks?.length) {
          doc.querySelectorAll('.tmpl-violation-item').forEach(item => {
            const checkbox = item.querySelector('.tmpl-checkbox');
            const textEl = checkbox?.nextElementSibling;
            if (textEl && checks.includes(textEl.textContent?.trim() || '')) {
              checkbox?.classList.add('tmpl-checked');
            }
          });
        }

        if (!readOnly) {
          doc.designMode = 'on';
        }
      }

      // Always re-attach listeners — the previous effect's cleanup removed them.

      const onMousedown = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const item = target.closest('.tmpl-violation-item');
        if (!item) return;

        const checkbox = item.querySelector('.tmpl-checkbox');
        if (!checkbox) return;

        e.preventDefault();
        checkbox.classList.toggle('tmpl-checked');

        // Sync checkbox state to parent — mousedown doesn't fire 'input'
        const content = doc.body?.innerHTML ?? '';
        dirtyContentRef.current = content;
        callbackRef.current?.(content);
      };
      doc.addEventListener('mousedown', onMousedown);

      const onInput = () => {
        const content = doc.body?.innerHTML ?? '';
        dirtyContentRef.current = content;
        callbackRef.current?.(content);
      };
      if (!readOnly) {
        doc.addEventListener('input', onInput);
        doc.addEventListener('selectionchange', updateActiveFormats);
        doc.addEventListener('keyup', updateActiveFormats);
        doc.addEventListener('mouseup', updateActiveFormats);
      }

      return () => {
        doc.removeEventListener('mousedown', onMousedown);
        if (!readOnly) {
          doc.removeEventListener('input', onInput);
          doc.removeEventListener('selectionchange', updateActiveFormats);
          doc.removeEventListener('keyup', updateActiveFormats);
          doc.removeEventListener('mouseup', updateActiveFormats);
        }
      };
    }, [htmlContent, readOnly, updateActiveFormats]);

    useImperativeHandle(
      ref,
      () => ({
        getContent: () => getDoc()?.body?.innerHTML ?? '',

        getFullHtml: () => {
          const doc = getDoc();
          if (!doc) return '';
          return `<!DOCTYPE html>\n<html>\n<head>${doc.head.innerHTML}</head>\n<body>${doc.body.innerHTML}</body>\n</html>`;
        },

        getCheckedReasons: () => {
          const doc = getDoc();
          if (!doc) return [];
          const reasons: string[] = [];
          doc.querySelectorAll('.tmpl-violation-item').forEach((item) => {
            const cb = item.querySelector('.tmpl-checkbox');
            if (cb?.classList.contains('tmpl-checked')) {
              const text = cb.nextElementSibling?.textContent?.trim();
              if (text) reasons.push(text);
            }
          });
          return reasons;
        },

        updateTemplateVars: (vars: Record<string, string>) => {
          const doc = getDoc();
          if (!doc) return;
          for (const [varName, value] of Object.entries(vars)) {
            doc.querySelectorAll(`[data-tmpl-var="${varName}"]`).forEach(el => {
              el.textContent = value;
            });
          }
        },

        syncContent: () => {
          const content = getDoc()?.body?.innerHTML ?? '';
          dirtyContentRef.current = content;
          return content;
        },

        flashViolations: () => {
          const doc = getDoc();
          const body = doc?.body;
          const target =
            doc?.querySelector('.tmpl-violation-list') ??
            doc?.querySelector('.tmpl-violation-item');
          if (!body || !target) return;
          if (attentionTimerRef.current !== null) {
            window.clearTimeout(attentionTimerRef.current);
          }
          // remove + reflow so repeated calls restart the animation
          body.classList.remove('tmpl-violations-attention');
          void body.offsetWidth;
          body.classList.add('tmpl-violations-attention');
          target.scrollIntoView({ block: 'center' });
          attentionTimerRef.current = window.setTimeout(() => {
            body.classList.remove('tmpl-violations-attention');
            attentionTimerRef.current = null;
          }, VIOLATION_ATTENTION_MS);
        },
      }),
      [getDoc],
    );

    if (!htmlContent) {
      return (
        <Box
          sx={{
            height,
            border: '1px solid',
            borderColor: error ? 'error.main' : 'divider',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Select a template to begin editing
          </Typography>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          border: error ? '2px solid' : '1px solid',
          borderColor: error ? 'error.main' : 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        {!readOnly && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              px: 1,
              py: 0.5,
              bgcolor: 'action.hover',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {TOOLBAR_BUTTONS.map((btn) => (
              <React.Fragment key={btn.command}>
                {btn.hasDividerBefore && (
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                )}
                <Tooltip title={btn.label} arrow>
                  <IconButton
                    size="small"
                    onClick={() => execCommand(btn.command)}
                    sx={{
                      borderRadius: 0.75,
                      bgcolor: activeFormats.has(btn.command) ? 'action.selected' : undefined,
                    }}
                  >
                    {btn.icon}
                  </IconButton>
                </Tooltip>
              </React.Fragment>
            ))}
            {toolbarExtra && (
              <>
                <Box sx={{ ml: 'auto' }} />
                {toolbarExtra}
              </>
            )}
          </Box>
        )}

        <iframe
          ref={iframeRef}
          style={{
            width: '100%',
            height: typeof height === 'number' ? `${height}px` : height,
            border: 'none',
            display: 'block',
            background: '#fff',
          }}
          title="Letter Editor"
        />
      </Box>
    );
  },
);

LetterIframeEditor.displayName = 'LetterIframeEditor';
