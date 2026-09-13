import { createElement } from 'react'
import { renderInlineMarkdown } from './markdownUtils.jsx'

export default function MarkdownPreview({ content, emptyMessage = 'Chưa có mô tả markdown.' }) {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return <p className="text-sm italic text-ink/35">{emptyMessage}</p>
  }

  const lines = normalized.split('\n')
  const blocks = []
  let index = 0

  const isBlockStart = (line) => (
    /^#{1,6}\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+\.\s+/.test(line)
    || line.trim().startsWith('```')
    || /^!\[([^\]]*)\]\(([^)]+)\)$/.test(line.trim())
  )

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const codeLines = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-xl bg-ink px-4 py-3 font-mono text-xs leading-6 text-white"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const Tag = `h${level + 2}` // h1 -> h3, h2 -> h4
      const cls = level === 1 ? 'mt-4 font-display text-base font-bold text-ink'
                : level === 2 ? 'mt-3 text-sm font-bold text-ink'
                : 'mt-2 text-sm font-semibold text-ink'
      blocks.push(
        createElement(Tag, { key: `h-${blocks.length}`, className: cls }, renderInlineMarkdown(headingMatch[2], `h-${blocks.length}`)),
      )
      index += 1
      continue
    }

    if (line.match(/^[-*+]\s+/) || line.match(/^\d+\.\s+/)) {
      const isOrdered = /^\d+\.\s+/.test(line)
      const listItems = []
      while (index < lines.length && (lines[index].match(/^[-*+]\s+/) || lines[index].match(/^\d+\.\s+/))) {
        const itemLine = lines[index].replace(/^([-*+]|\d+\.)\s+/, '')
        listItems.push(itemLine)
        index += 1
      }
      const Tag = isOrdered ? 'ol' : 'ul'
      const listCls = isOrdered ? 'list-decimal' : 'list-disc'
      blocks.push(
        createElement(
          Tag,
          { key: `list-${blocks.length}`, className: `ml-4 space-y-1 ${listCls} text-sm leading-6 text-ink/80` },
          listItems.map((item, i) => (
            <li key={i}>{renderInlineMarkdown(item, `li-${i}`)}</li>
          )),
        ),
      )
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-2 border-clay/30 bg-clay/[0.04] px-4 py-2 text-sm italic leading-6 text-ink/75"
        >
          {quoteLines.map((ql, i) => (
            <p key={i} className="min-h-[1.5rem]">
              {renderInlineMarkdown(ql, `quote-${i}`)}
            </p>
          ))}
        </blockquote>,
      )
      continue
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imageMatch) {
      blocks.push(
        <figure key={`img-${blocks.length}`} className="my-2">
          <img
            src={imageMatch[2]}
            alt={imageMatch[1]}
            className="max-w-full rounded-lg border border-stone"
            loading="lazy"
          />
          {imageMatch[1] && (
            <figcaption className="mt-1 text-xs text-ink/40 italic">
              {imageMatch[1]}
            </figcaption>
          )}
        </figure>,
      )
      index += 1
      continue
    }

    const pLines = []
    while (index < lines.length && !isBlockStart(lines[index]) && lines[index].trim() !== '') {
      pLines.push(lines[index])
      index += 1
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-6 text-ink/80">
        {pLines.map((pl, i) => (
          <span key={i}>
            {renderInlineMarkdown(pl, `p-${i}`)}
            {i < pLines.length - 1 && <br />}
          </span>
        ))}
      </p>,
    )
  }

  return <div className="space-y-3">{blocks}</div>
}
