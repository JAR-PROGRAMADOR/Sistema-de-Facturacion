export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p className="muted">Próximamente en una sub-fase siguiente.</p>
    </section>
  );
}