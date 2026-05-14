export default function HebWord({ text }) {
  if (!text) return null

  const parts = text.split(' | ')

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^(\([^)]+\))\s*(.+)$/)
        return (
          <span key={i}>
            {i > 0 && <span className="opacity-25 mx-1.5">|</span>}
            {match ? (
              <>
                <span className="text-xs font-normal opacity-40">{match[1]} </span>
                <span>{match[2]}</span>
              </>
            ) : (
              part
            )}
          </span>
        )
      })}
    </>
  )
}
