export function normalizeUrl(url = '') {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed
  return null
}

export function renderInlineMarkdown(text, keyPrefix = 'md') {
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  const nodes = []
  let cursor = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index))
    }

    if (match[0].startsWith('![')) {
      const alt = match[2] || ''
      const src = match[3]
      nodes.push(
        <img
          key={`${keyPrefix}-${nodes.length}`}
          src={src}
          alt={alt}
          className="inline-block max-h-64 rounded border border-stone"
          loading="lazy"
        />,
      )
    } else if (match[4]) {
      const href = normalizeUrl(match[5])
      if (href) {
        nodes.push(
          <a
            key={`${keyPrefix}-${nodes.length}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#3E7CA8] underline underline-offset-2 hover:opacity-80"
          >
            {match[4]}
          </a>,
        )
      } else {
        nodes.push(match[4])
      }
    } else if (match[6]) {
      nodes.push(<strong key={`${keyPrefix}-${nodes.length}`} className="font-semibold text-ink">{match[6]}</strong>)
    } else if (match[7]) {
      nodes.push(
        <code
          key={`${keyPrefix}-${nodes.length}`}
          className="rounded bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[0.92em] text-ink"
        >
          {match[7]}
        </code>,
      )
    } else if (match[8]) {
      nodes.push(<em key={`${keyPrefix}-${nodes.length}`} className="italic text-ink">{match[8]}</em>)
    }

    cursor = pattern.lastIndex
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes.length > 0 ? nodes : text
}

export function stripMarkdown(markdown = '') {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[>*_~]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
