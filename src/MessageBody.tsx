import ReactMarkdown from 'react-markdown'

type Role = 'user' | 'assistant'

export function MessageBody({ role, content }: { role: Role; content: string }) {
  if (role === 'user') {
    return <div className="bubble-text">{content}</div>
  }
  return (
    <div className="bubble-md">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
