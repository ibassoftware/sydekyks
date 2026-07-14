import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";

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

/** A reusable rich-text (HTML) editor built on TipTap. Value in/out is HTML. `onInsertImage` uploads
 * a picked file and returns a URL to embed. Quill is the only consumer today, but this is deliberately
 * generic so a future document-generation Sydekyk can reuse it. */
export function RichDocEditor({
  value,
  onChange,
  onInsertImage,
  editable = true,
}: {
  value: string;
  onChange: (html: string) => void;
  onInsertImage?: (file: File) => Promise<string | null>;
  editable?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      SizedImage.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "quill-doc-content min-h-[60vh] max-w-none px-8 py-6 outline-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sync external content changes (AI generate / chat rewrite) into the editor without clobbering
  // the user's caret while they type (only reset when the incoming value truly differs).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onInsertImage) return;
    const url = await onInsertImage(file);
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }

  const imageSelected = editor.isActive("image");

  const Btn = ({ on, active, label, title }: { on: () => void; active?: boolean; label: string; title: string }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={`rounded px-2 py-1 text-sm font-medium transition-colors ${
        active ? "bg-gold-500/20 text-gold-200" : "text-[#b9ad98] hover:bg-ink-800 hover:text-[#ede6da]"
      }`}
    >
      {label}
    </button>
  );

  const Sep = () => <span className="mx-1 h-5 w-px bg-ink-600" />;

  return (
    <div className="flex h-full flex-col rounded-xl border border-ink-600 bg-[#fbfaf7]">
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-ink-600 bg-ink-900 px-2 py-1.5">
          <Btn title="Bold" label="B" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()} />
          <Btn title="Italic" label="I" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()} />
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
          <Btn title="Bullet list" label="• List" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()} />
          <Btn title="Numbered list" label="1. List" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()} />
          <Btn title="Quote" label="❝" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()} />
          <Btn title="Divider" label="―" on={() => editor.chain().focus().setHorizontalRule().run()} />
          {onInsertImage && (
            <>
              <Sep />
              <Btn title="Insert image" label="🖼 Image" on={() => fileRef.current?.click()} />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
            </>
          )}
          {imageSelected && (
            <>
              <Sep />
              <span className="px-1 text-[11px] uppercase tracking-wider text-[#8a7f6d]">Image</span>
              <Btn title="Small (25%)" label="25%" on={() => editor.chain().focus().updateAttributes("image", { width: "25%" }).run()} />
              <Btn title="Medium (50%)" label="50%" on={() => editor.chain().focus().updateAttributes("image", { width: "50%" }).run()} />
              <Btn title="Large (75%)" label="75%" on={() => editor.chain().focus().updateAttributes("image", { width: "75%" }).run()} />
              <Btn title="Full width" label="Full" on={() => editor.chain().focus().updateAttributes("image", { width: "100%" }).run()} />
            </>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto text-ink-950">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
