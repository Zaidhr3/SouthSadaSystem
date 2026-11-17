/** يُعاد تركيبه مع كل تنقل — يمنح كل صفحة دخولاً ناعماً */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
