import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Heading from "@tiptap/extension-heading";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";

/** Heading that keeps an explicit text colour, so a colour set on the whole title (by the AI's HTML
 * or the toolbar picker) survives TipTap's parse instead of being stripped. */
const ColorHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.color || null,
        renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {}),
      },
    };
  },
});

/** Image extension that carries a `width` attribute (rendered as an inline style), so the toolbar can
 * resize an embedded image to a few sensible presets. */
const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}` } : {}),
        parseHTML: (el) => (el as HTMLElement).style.width || null,
      },
    };
  },
});

const FONTS = [
  { label: "Default", value: "" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Times", value: "'Times New Roman', serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Courier", value: "'Courier New', monospace" },
];
const SIZES = ["", "12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px"];

/** A reusable rich-text (HTML) editor built on TipTap. Value in/out is HTML. `onInsertImage` uploads
 * a picked file and returns a URL to embed. `busy` overlays an "AI is editing" state. */
export function RichDocEditor({
  value,
  onChange,
  onInsertImage,
  editable = true,
  busy = false,
  accent,
}: {
  value: string;
  onChange: (html: string) => void;
  onInsertImage?: (file: File) => Promise<string | null>;
  editable?: boolean;
  busy?: boolean;
  accent?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: false, link: { openOnClick: false } }),
      ColorHeading.configure({ levels: [1, 2, 3] }),
      SizedImage.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: true } }),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: "quill-doc-content min-h-[60vh] max-w-none px-8 py-6 outline-none" },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sync external content changes (AI generate / chat rewrite) into the editor without clobbering the
  // caret while typing (only reset when the incoming value truly differs).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable && !busy);
  }, [editable, busy, editor]);

  if (!editor) return null;

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onInsertImage) return;
    const url = await onInsertImage(file);
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }

  function setLink() {
    const prev = editor!.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const inTable = editor.isActive("table");
  const imageSelected = editor.isActive("image");
  const curFont = (editor.getAttributes("textStyle").fontFamily as string) ?? "";
  const curSize = (editor.getAttributes("textStyle").fontSize as string) ?? "";
  const curColor = (editor.getAttributes("textStyle").color as string) ?? "#1a1a1a";

  const Btn = ({ on, active, label, title, disabled }: { on: () => void; active?: boolean; label: string; title: string; disabled?: boolean }) => (
    <button
      type="button" title={title} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={`rounded px-2 py-1 text-sm font-medium transition-colors disabled:opacity-30 ${
        active ? "bg-gold-500/20 text-gold-200" : "text-[#b9ad98] hover:bg-ink-800 hover:text-[#ede6da]"
      }`}
    >
      {label}
    </button>
  );
  const Sep = () => <span className="mx-1 h-5 w-px bg-ink-600" />;
  const selectCls = "rounded border border-ink-600 bg-ink-900 px-1.5 py-1 text-xs text-[#ede6da] outline-none focus:border-gold-500";

  return (
    <div
      className="flex h-full flex-col rounded-xl border border-ink-600 bg-[#fbfaf7]"
      style={accent ? ({ "--quill-accent": accent } as React.CSSProperties) : undefined}
    >
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-ink-600 bg-ink-900 px-2 py-1.5">
          <Btn title="Undo" label="↺" on={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
          <Btn title="Redo" label="↻" on={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
          <Sep />
          <select title="Font" className={selectCls} value={curFont}
            onChange={(e) => { const v = e.target.value; if (v) editor.chain().focus().setFontFamily(v).run(); else editor.chain().focus().unsetFontFamily().run(); }}>
            {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <select title="Font size" className={`${selectCls} ml-1`} value={curSize}
            onChange={(e) => { const v = e.target.value; if (v) editor.chain().focus().setFontSize(v).run(); else editor.chain().focus().unsetFontSize().run(); }}>
            {SIZES.map((s) => <option key={s || "def"} value={s}>{s ? s.replace("px", "") : "Size"}</option>)}
          </select>
          <Sep />
          <Btn title="Bold" label="B" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()} />
          <Btn title="Italic" label="I" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()} />
          <Btn title="Underline" label="U" active={editor.isActive("underline")} on={() => editor.chain().focus().toggleUnderline().run()} />
          <Btn title="Strikethrough" label="S" active={editor.isActive("strike")} on={() => editor.chain().focus().toggleStrike().run()} />
          <label title="Text colour" className="relative ml-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-ink-600" style={{ color: curColor }}>
            <span className="text-sm font-bold">A</span>
            <input type="color" value={/^#/.test(curColor) ? curColor : "#1a1a1a"} onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
          <Btn title="Highlight" label="🖊" active={editor.isActive("highlight")} on={() => editor.chain().focus().toggleHighlight({ color: "#fff3a3" }).run()} />
          <Sep />
          <Btn title="Heading 1" label="H1" active={editor.isActive("heading", { level: 1 })} on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
          <Btn title="Heading 2" label="H2" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <Btn title="Heading 3" label="H3" active={editor.isActive("heading", { level: 3 })} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <Sep />
          <Btn title="Align left" label="⯇" active={editor.isActive({ textAlign: "left" })} on={() => editor.chain().focus().setTextAlign("left").run()} />
          <Btn title="Align center" label="≡" active={editor.isActive({ textAlign: "center" })} on={() => editor.chain().focus().setTextAlign("center").run()} />
          <Btn title="Align right" label="⯈" active={editor.isActive({ textAlign: "right" })} on={() => editor.chain().focus().setTextAlign("right").run()} />
          <Btn title="Justify" label="☰" active={editor.isActive({ textAlign: "justify" })} on={() => editor.chain().focus().setTextAlign("justify").run()} />
          <Sep />
          <Btn title="Bullet list" label="•" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()} />
          <Btn title="Numbered list" label="1." active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()} />
          <Btn title="Quote" label="❝" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()} />
          <Btn title="Link" label="🔗" active={editor.isActive("link")} on={setLink} />
          <Btn title="Divider" label="―" on={() => editor.chain().focus().setHorizontalRule().run()} />
          <Btn title="Insert table" label="▦" on={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          {onInsertImage && (
            <>
              <Btn title="Insert image" label="🖼" on={() => fileRef.current?.click()} />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
            </>
          )}

          {inTable && (
            <div className="mt-1 flex w-full flex-wrap items-center gap-0.5 border-t border-ink-700 pt-1">
              <span className="px-1 text-[11px] uppercase tracking-wider text-[#8a7f6d]">Table</span>
              <Btn title="Add column" label="+Col" on={() => editor.chain().focus().addColumnAfter().run()} />
              <Btn title="Delete column" label="−Col" on={() => editor.chain().focus().deleteColumn().run()} />
              <Btn title="Add row" label="+Row" on={() => editor.chain().focus().addRowAfter().run()} />
              <Btn title="Delete row" label="−Row" on={() => editor.chain().focus().deleteRow().run()} />
              <Btn title="Toggle header row" label="Header" on={() => editor.chain().focus().toggleHeaderRow().run()} />
              <Btn title="Merge/split cells" label="Merge" on={() => editor.chain().focus().mergeOrSplit().run()} />
              <Btn title="Delete table" label="Delete table" on={() => editor.chain().focus().deleteTable().run()} />
            </div>
          )}
          {imageSelected && (
            <div className="mt-1 flex w-full flex-wrap items-center gap-0.5 border-t border-ink-700 pt-1">
              <span className="px-1 text-[11px] uppercase tracking-wider text-[#8a7f6d]">Image</span>
              {["25%", "50%", "75%", "100%"].map((w) => (
                <Btn key={w} title={`Width ${w}`} label={w} on={() => editor.chain().focus().updateAttributes("image", { width: w }).run()} />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="relative flex-1 overflow-y-auto text-ink-950">
        <EditorContent editor={editor} />
        {busy && (
          <div className="pointer-events-auto absolute inset-0 flex items-start justify-center bg-white/40 backdrop-blur-[1px]">
            <div className="mt-16 flex items-center gap-3 rounded-full border border-gold-600/50 bg-ink-900/95 px-4 py-2 shadow-xl">
              <span className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gold-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gold-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gold-400" />
              </span>
              <span className="text-sm font-medium text-gold-200">Quill is writing…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
