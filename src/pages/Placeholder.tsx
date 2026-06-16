export function Placeholder({ title }: { title: string }) {
  return (
    <main className="page">
      <section className="card">
        <h3>{title}</h3>
        <p className="muted">
          Tela mapeada no sistema original. O proximo passo e ligar esta tela aos
          endpoints correspondentes e reconstruir os componentes especificos.
        </p>
      </section>
    </main>
  );
}
