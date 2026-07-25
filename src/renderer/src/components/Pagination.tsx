const pageTokens = (page: number, totalPages: number): Array<number | 'ellipsis'> => {
  const visible = new Set([1, totalPages, page - 1, page, page + 1])
  const pages = [...visible].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b)
  const tokens: Array<number | 'ellipsis'> = []
  pages.forEach((item, index) => {
    if (index > 0 && item - pages[index - 1] > 1) tokens.push('ellipsis')
    tokens.push(item)
  })
  return tokens
}

export function Pagination({
  label,
  page,
  pageSize,
  totalItems,
  onPageChange
}: {
  label: string
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
}): React.JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalPages <= 1) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)

  return (
    <nav aria-label={`${label} pages`} className="pagination">
      <span className="pagination-summary">
        {start}–{end} of {totalItems}
      </span>
      <div>
        <button
          aria-label={`Previous ${label} page`}
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Previous
        </button>
        {pageTokens(page, totalPages).map((token, index) =>
          token === 'ellipsis' ? (
            <span aria-hidden="true" className="pagination-ellipsis" key={`ellipsis-${index}`}>
              …
            </span>
          ) : (
            <button
              aria-current={token === page ? 'page' : undefined}
              aria-label={`${label} page ${token}`}
              className={token === page ? 'active' : ''}
              key={token}
              onClick={() => onPageChange(token)}
              type="button"
            >
              {token}
            </button>
          )
        )}
        <button
          aria-label={`Next ${label} page`}
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </nav>
  )
}
