export function PageHeader({ title, subtitle, aside }: { title: string; subtitle: string; aside?: React.ReactNode }) {
  return <header className="page-header"><div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>{aside}</header>;
}
