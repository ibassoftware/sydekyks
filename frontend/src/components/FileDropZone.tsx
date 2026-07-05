import { useRef, useState, type DragEvent } from "react";

export function FileDropZone({
  accept,
  disabled,
  onFiles,
  hint,
}: {
  accept: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-ink-700 opacity-50"
          : dragging
            ? "border-gold-500 bg-gold-500/5"
            : "border-ink-600 hover:border-gold-600/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <span className="text-2xl">📄</span>
      <p className="mt-2 text-sm font-semibold text-[#ede6da]">Drag &amp; drop bills here, or click to browse</p>
      {hint && <p className="mt-1 text-xs text-[#8a7f6d]">{hint}</p>}
    </div>
  );
}
