import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import CodeMirror from '@uiw/react-codemirror';
import { useTheme } from '@oslab/core';
import { useMemo } from 'react';
import type { Diagnostic, Language } from '../engine/protocol';

function decorations(
  view: EditorView,
  current: number | null,
  errorLine: number | null,
  diagnostics: Diagnostic[],
): DecorationSet {
  const doc = view.state.doc;
  const styles = new Map<number, string>();
  for (const d of diagnostics) {
    if (d.severity === 'note') continue;
    const prev = styles.get(d.line);
    if (prev?.includes('225, 29, 72')) continue;
    styles.set(
      d.line,
      d.severity === 'error'
        ? 'background: rgba(225, 29, 72, 0.16); box-shadow: inset 3px 0 0 rgb(225, 29, 72)'
        : 'background: rgba(245, 158, 11, 0.16); box-shadow: inset 3px 0 0 rgb(245, 158, 11)',
    );
  }
  if (errorLine !== null) {
    styles.set(
      errorLine,
      'background: rgba(225, 29, 72, 0.2); box-shadow: inset 3px 0 0 rgb(225, 29, 72)',
    );
  }
  if (current !== null) {
    styles.set(
      current,
      'background: rgba(79, 70, 229, 0.18); box-shadow: inset 3px 0 0 rgb(79, 70, 229)',
    );
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of [...styles.keys()].sort((a, b) => a - b)) {
    if (line < 1 || line > doc.lines) continue;
    builder.add(
      doc.line(line).from,
      doc.line(line).from,
      Decoration.line({ attributes: { style: styles.get(line) as string } }),
    );
  }
  return builder.finish();
}

export function Editor({
  language,
  value,
  onChange,
  currentLine,
  errorLine,
  diagnostics,
  onRun,
}: {
  language: Language;
  value: string;
  onChange: (v: string) => void;
  currentLine: number | null;
  errorLine: number | null;
  diagnostics: Diagnostic[];
  onRun: () => void;
}) {
  const { theme } = useTheme();
  const extensions = useMemo(
    () => [
      language === 'python' ? python() : cpp(),
      EditorView.lineWrapping,
      EditorView.decorations.of((view) => decorations(view, currentLine, errorLine, diagnostics)),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRun();
              return true;
            },
          },
        ]),
      ),
    ],
    [language, currentLine, errorLine, diagnostics, onRun],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={theme === 'dark' ? 'dark' : 'light'}
      basicSetup={{ foldGutter: false, highlightActiveLine: false, tabSize: 4 }}
      minHeight="300px"
      maxHeight="65vh"
      aria-label={language === 'python' ? 'Python source code' : 'C source code'}
      className="overflow-hidden rounded-md border border-slate-300 text-[0.9rem] dark:border-slate-600"
    />
  );
}
