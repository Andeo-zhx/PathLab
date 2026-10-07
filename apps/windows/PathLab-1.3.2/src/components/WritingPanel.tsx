import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Plus,
  X,
} from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { IconButton } from './IconButton';

interface BlockItem {
  id: string;
  label: string;
  run: (editor: Editor) => void;
}

const text = (t: string) => ({ type: 'text', text: t });

const STRUCTURE: BlockItem[] = [
  {
    id: 'slice',
    label: '切片描述',
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 2 }, content: [text('切片描述')] },
          { type: 'paragraph', content: [text('低倍镜下：')] },
          { type: 'paragraph', content: [text('高倍镜下：')] },
        ])
        .run(),
  },
  {
    id: 'gross',
    label: '大体描述',
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 2 }, content: [text('大体描述')] },
          { type: 'paragraph', content: [text('整体：')] },
          { type: 'paragraph', content: [text('病灶：')] },
        ])
        .run(),
  },
  {
    id: 'diagnosis',
    label: '病理诊断',
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 2 }, content: [text('病理诊断')] },
          { type: 'paragraph' },
        ])
        .run(),
  },
];

const FORMAT: BlockItem[] = [
  { id: 'h1', label: '一级标题', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: '二级标题', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
];

function countWords(docText: string): number {
  const cjk = (docText.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const latin = (docText.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? []).length;
  return cjk + latin;
}

function InsertMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="insert-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="插入结构块"
        data-tip-side="bottom"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={15} strokeWidth={2.1} aria-hidden />
        插入
      </button>
      {open && (
        <div className="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 226 }}>
          <div className="menu-title">结构块</div>
          {STRUCTURE.map((item) => (
            <button
              key={item.id}
              type="button"
              className="menu-item"
              onClick={() => {
                item.run(editor!);
                setOpen(false);
              }}
            >
              <span className="mi-label">{item.label}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-title">段落</div>
          {FORMAT.map((item) => (
            <button
              key={item.id}
              type="button"
              className="menu-item"
              onClick={() => {
                item.run(editor!);
                setOpen(false);
              }}
            >
              <span className="mi-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BubbleBar({ editor, pos }: { editor: Editor; pos: { x: number; y: number } }) {
  /**
   * 在 mousedown 阶段执行命令：此时 DOM 选区仍然有效。
   * 键盘触发的 click（detail === 0）再走一次，保证可访问性。
   */
  const act = (run: () => void) => ({
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      run();
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) run();
    },
  });

  return (
    <div className="bubble-bar" style={{ left: pos.x, top: Math.max(12, pos.y - 52), transform: 'translateX(-50%)' }}>
      <IconButton size="sm" label="粗体" tip="粗体 ⌘B" active={editor.isActive('bold')} {...act(() => editor.chain().focus().toggleBold().run())}>
        <Bold size={17} strokeWidth={1.9} />
      </IconButton>
      <IconButton size="sm" label="斜体" tip="斜体 ⌘I" active={editor.isActive('italic')} {...act(() => editor.chain().focus().toggleItalic().run())}>
        <Italic size={17} strokeWidth={1.9} />
      </IconButton>
      <span className="sep" />
      <IconButton
        size="sm"
        label="一级标题"
        tip="一级标题"
        active={editor.isActive('heading', { level: 1 })}
        {...act(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
      >
        <Heading1 size={17} strokeWidth={1.9} />
      </IconButton>
      <IconButton
        size="sm"
        label="二级标题"
        tip="二级标题"
        active={editor.isActive('heading', { level: 2 })}
        {...act(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      >
        <Heading2 size={17} strokeWidth={1.9} />
      </IconButton>
      <span className="sep" />
      <IconButton
        size="sm"
        label="项目符号列表"
        tip="项目符号列表"
        active={editor.isActive('bulletList')}
        {...act(() => editor.chain().focus().toggleBulletList().run())}
      >
        <List size={17} strokeWidth={1.9} />
      </IconButton>
      <IconButton
        size="sm"
        label="编号列表"
        tip="编号列表"
        active={editor.isActive('orderedList')}
        {...act(() => editor.chain().focus().toggleOrderedList().run())}
      >
        <ListOrdered size={17} strokeWidth={1.9} />
      </IconButton>
    </div>
  );
}

export function WritingPanel({ onHide }: { onHide: () => void }) {
  const title = useProject((s) => s.project.title);
  const setTextDocument = useProject((s) => s.setTextDocument);
  const textSyncToken = useUi((s) => s.textSyncToken);
  const [words, setWords] = useState(0);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const flush = useCallback(
    (editor: Editor) => {
      setTextDocument(editor.getJSON());
      setWords(countWords(editor.state.doc.textContent));
    },
    [setTextDocument],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: '在这里记录你的观察……' }),
    ],
    content: useProject.getState().project.textDocument as Record<string, unknown>,
    editorProps: {
      attributes: {
        class: 'prose-editor',
        'aria-label': '观察记录编辑区',
      },
      // 只接受纯文本，避免把外部网页样式带进来
      transformPastedHTML: (html: string) => html.replace(/<[^>]+>/g, ' '),
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        if (Array.from(data.files ?? []).some((f) => f.type.startsWith('image/'))) return false;
        const hasHtml = data.types.includes('text/html');
        const text = data.getData('text/plain');
        if (!hasHtml || !text) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setWords(countWords(ed.state.doc.textContent));
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => flush(ed), 500);
    },
  });

  // 工程被替换（打开 / 新建 / 撤销）时同步内容
  useEffect(() => {
    if (!editor) return;
    const doc = useProject.getState().project.textDocument;
    editor.commands.setContent(doc as Record<string, unknown>, { emitUpdate: false });
    setWords(countWords(editor.state.doc.textContent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textSyncToken, editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setBubble(null);
        return;
      }
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        setBubble(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setBubble(null);
        return;
      }
      const panel = panelRef.current?.getBoundingClientRect();
      if (!panel) {
        setBubble(null);
        return;
      }
      setBubble({
        x: rect.left + rect.width / 2 - panel.left,
        y: rect.top - panel.top,
      });
    };
    const onBlur = () => setBubble(null);
    editor.on('selectionUpdate', update);
    editor.on('blur', onBlur);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('blur', onBlur);
    };
  }, [editor]);

  const summary = useMemo(() => (words ? `${words} 字` : '尚未记录'), [words]);

  return (
    <section className="writing-panel" aria-label="观察记录" ref={panelRef}>
      <div className="writing-head">
        <div className="wh-titles">
          <h2 className="writing-title">{title}</h2>
        </div>
        <InsertMenu editor={editor} />
        <button
          type="button"
          className="icon-btn sm writing-hide"
          aria-label="隐藏观察记录"
          title="隐藏观察记录"
          onClick={onHide}
        >
          <X size={17} strokeWidth={1.8} />
        </button>
      </div>

      <div className="writing-scroll scroll-thin">
        <EditorContent editor={editor} />
      </div>

      <div className="writing-foot">
        <div className="word-count">{summary}</div>
      </div>

      {bubble && editor && <BubbleBar editor={editor} pos={bubble} />}
    </section>
  );
}
