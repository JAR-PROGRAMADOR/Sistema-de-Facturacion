import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="auth-shell">
      <div className="card auth-card" style={{ textAlign: 'center' }}>
        <h1>404</h1>
        <p>Página no encontrada.</p>
        <p>
          <Link to="/">Volver al inicio</Link>
        </p>
      </div>
    </main>
  );
}