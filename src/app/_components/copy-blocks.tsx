import type { CopyBlock } from "../../schemas/draft";

export function CopyBlocks({ blocks }: { blocks: CopyBlock[] }) {
  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <section key={block.id}>
          {block.heading && (
            <h2 className="text-xl font-bold mb-3" style={{ color: "var(--color-text-heading)" }}>
              {block.heading}
            </h2>
          )}
          <div
            className="text-sm leading-relaxed prose-sm"
            style={{ color: "var(--color-text)" }}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(block.bodyMarkdown) }}
          />
        </section>
      ))}
    </div>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul class="list-disc pl-5 my-2">${match}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(.+)$/gm, (line) => {
      if (line.startsWith("<ul") || line.startsWith("<li") || line.startsWith("</")) return line;
      return line;
    })
    .replace(/^(?!<)(.+)/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "");
}
