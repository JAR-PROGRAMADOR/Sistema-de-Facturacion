import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/api/error';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useLowStock, useSalesSummary } from './api';

const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);
const chartWidth = 760;
const chartHeight = 280;
const chartPadding = { top: 20, right: 18, bottom: 42, left: 62 };

function salesChartPoints(daily: Array<{ day: string; salesCount: number; total: number }>) {
  const end = new Date(`${dateInputValue(new Date())}T00:00:00Z`);
  const values = new Map(daily.map((item) => [item.day, item]));
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (29 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, total: values.get(day)?.total ?? 0, salesCount: values.get(day)?.salesCount ?? 0 };
  });
  const max = Math.max(1, ...days.map((item) => item.total));
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const points = days.map((item, index) => ({
    ...item,
    x: chartPadding.left + (index / (days.length - 1)) * plotWidth,
    y: chartPadding.top + plotHeight - (item.total / max) * plotHeight,
  }));
  return { days: points, max, plotHeight, plotWidth };
}

export function DashboardPage() {
  const { companyId, companies, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const from = dateInputValue(new Date(Date.now() - 29 * 86_400_000));
  const to = dateInputValue(new Date());
  const sales = useSalesSummary(companyId, isPlatform, from, to);
  const lowStock = useLowStock(companyId, isPlatform);
  const companyName = companies.find((company) => company.id === companyId)?.name;
  const chart = salesChartPoints(sales.data?.daily ?? []);
  const chartLabels = [0, 7, 14, 21, 29];
  const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const compactCurrency = (amount: number) => amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const recentDaily = chart.days.slice(-7);
  const recentMax = Math.max(1, ...recentDaily.map((day) => day.total));
  const barWidth = chart.plotWidth / chart.days.length * 0.62;

  if (companyLoading || sales.isLoading || lowStock.isLoading) {
    return <div className="center"><Spinner /></div>;
  }

  if (!companyId) {
    return (
      <section className="card">
        <h1>Inicio</h1>
        <p className="muted">Selecciona una empresa para ver el resumen de operaciones.</p>
      </section>
    );
  }

  return (
    <div className="dashboard dashboard--dark stack">
      <section className="dashboard__hero">
        <header className="dashboard__hero-header">
          <div>
            <span className="dashboard__eyebrow"><span className="dashboard__live-dot" /> RESUMEN · ÚLTIMOS 30 DÍAS</span>
            <h1>{companyName ? `Todo en marcha, ${companyName}` : 'Tu negocio, en perspectiva'}</h1>
            <p>Ventas, actividad e inventario en un solo lugar.</p>
          </div>
          <div className="dashboard__hero-actions">
            <span className="dashboard__date">{dateFormatter.format(new Date())}</span>
            <Link className="dashboard__action" to="/ventas"><span aria-hidden="true">＋</span> Nueva venta</Link>
          </div>
        </header>
        <div className="dashboard__hero-foot">
          <span><strong>{sales.data?.salesCount ?? 0}</strong> ventas completadas</span>
          <span className="dashboard__hero-separator" />
          <span>Ingresos <strong>{compactCurrency(sales.data?.total ?? 0)}</strong></span>
          <span className="dashboard__hero-separator" />
          <span><strong>{lowStock.data?.length ?? 0}</strong> alertas de inventario</span>
        </div>
        {(sales.isError || lowStock.isError) && (
          <div className="dashboard__notice" role="status">
          {sales.isError && <p className="field__error">{sales.error instanceof ApiError ? sales.error.message : 'No se pudo cargar el resumen de ventas.'}</p>}
          {lowStock.isError && <p className="field__error">{lowStock.error instanceof ApiError ? lowStock.error.message : 'No se pudo cargar el resumen de inventario.'}</p>}
          </div>
        )}
      </section>

      <header className="dashboard__category">
        <span className="dashboard__category-index">01</span>
        <div><span className="dashboard__eyebrow dashboard__eyebrow--light">VISTA GENERAL</span><h2>Indicadores clave</h2></div>
        <p>Un resumen de la actividad de tu negocio en los últimos 30 días.</p>
      </header>
      <section className="dashboard__metrics">
        <article className="dashboard__metric dashboard__metric--revenue">
          <div className="dashboard__metric-top"><span className="dashboard__metric-icon">↗</span><span className="dashboard__metric-period">30 DÍAS</span></div>
          <span className="dashboard__metric-label">Ingresos totales</span>
          <strong>{compactCurrency(sales.data?.total ?? 0)}</strong>
          <span className="dashboard__metric-note">Ventas completadas</span>
          <div className="dashboard__mini-bars" aria-hidden="true">
            {recentDaily.map((day) => <i key={day.day} style={{ height: `${Math.max(8, day.total / recentMax * 100)}%` }} />)}
          </div>
        </article>
        <article className="dashboard__metric dashboard__metric--count">
          <div className="dashboard__metric-top"><span className="dashboard__metric-icon">▤</span><span className="dashboard__metric-period">ACTIVIDAD</span></div>
          <span className="dashboard__metric-label">Ventas realizadas</span>
          <strong>{sales.data?.salesCount ?? 0}</strong>
          <span className="dashboard__metric-note">Transacciones en el período</span>
          <div className="dashboard__metric-accent" />
        </article>
        <article className="dashboard__metric dashboard__metric--tax">
          <div className="dashboard__metric-top"><span className="dashboard__metric-icon">◉</span><span className="dashboard__metric-period">IMPUESTOS</span></div>
          <span className="dashboard__metric-label">Impuestos recaudados</span>
          <strong>{compactCurrency(sales.data?.taxTotal ?? 0)}</strong>
          <span className="dashboard__metric-note">Acumulado del período</span>
          <div className="dashboard__metric-accent" />
        </article>
        <article className="dashboard__metric dashboard__metric--stock">
          <div className="dashboard__metric-top"><span className="dashboard__metric-icon">!</span><span className="dashboard__metric-period">INVENTARIO</span></div>
          <span className="dashboard__metric-label">Alertas de inventario</span>
          <strong>{lowStock.data?.length ?? 0}</strong>
          <span className="dashboard__metric-note">Productos bajo el mínimo</span>
          <Link className="dashboard__metric-link" to="/inventario">Revisar inventario <span aria-hidden="true">→</span></Link>
        </article>
      </section>

      <header className="dashboard__category">
        <span className="dashboard__category-index dashboard__category-index--blue">02</span>
        <div><span className="dashboard__eyebrow dashboard__eyebrow--light">ANÁLISIS COMERCIAL</span><h2>Rendimiento de ventas</h2></div>
        <p>Explora cómo evolucionan tus ingresos día a día.</p>
      </header>
      <section className="card dashboard__chart-card">
        <header className="dashboard__section-header">
          <div>
            <span className="dashboard__eyebrow dashboard__eyebrow--light">RENDIMIENTO DE VENTAS</span>
            <h2>Ingresos a lo largo del tiempo</h2>
            <p className="muted">Actividad diaria de los últimos 30 días.</p>
          </div>
          <div className="dashboard__chart-total"><span>Total del período</span><strong>{compactCurrency(sales.data?.total ?? 0)}</strong></div>
        </header>
        {sales.isError ? <p className="muted">No se pudo cargar la gráfica de ventas.</p> : (sales.data?.daily.length ?? 0) === 0 ? (
          <div className="dashboard__chart-empty">
            <span aria-hidden="true">↗</span>
            <p>Aún no hay ventas en este período.</p>
            <Link to="/ventas">Registra la primera venta</Link>
          </div>
        ) : (
          <div className="dashboard__chart-wrap">
            <svg
              className="dashboard__chart"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label="Gráfica de barras de ingresos diarios de los últimos 30 días"
            >
              <defs>
                <linearGradient id="sales-bar-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#58d9b2" />
                  <stop offset="100%" stopColor="#267da3" stopOpacity=".68" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3].map((step) => {
                const y = chartPadding.top + (chart.plotHeight / 3) * step;
                const value = chart.max * (1 - step / 3);
                return (
                  <g key={step}>
                    <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} className="dashboard__chart-grid" />
                    <text x={chartPadding.left - 10} y={y + 4} textAnchor="end" className="dashboard__chart-label">
                      {value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })}
                    </text>
                  </g>
                );
              })}
              {chart.days.map((point) => (
                <g key={point.day}>
                  <rect
                    x={point.x - barWidth / 2}
                    y={point.total > 0 ? Math.min(point.y, chartHeight - chartPadding.bottom - 2) : chartHeight - chartPadding.bottom}
                    width={barWidth}
                    height={point.total > 0 ? Math.max(2, chartHeight - chartPadding.bottom - point.y) : 0}
                    rx="3"
                    className="dashboard__chart-bar"
                  />
                  <title>{`${point.day}: ${point.total.toFixed(2)} · ${point.salesCount} venta(s)`}</title>
                </g>
              ))}
              {chartLabels.map((index) => (
                <text
                  key={index}
                  x={chart.days[index]!.x}
                  y={chartHeight - 12}
                  textAnchor={index === 0 ? 'start' : index === 29 ? 'end' : 'middle'}
                  className="dashboard__chart-label"
                >
                  {dateFormatter.format(new Date(`${chart.days[index]!.day}T00:00:00Z`))}
                </text>
              ))}
            </svg>
          </div>
        )}
      </section>

      <header className="dashboard__category">
        <span className="dashboard__category-index dashboard__category-index--amber">03</span>
        <div><span className="dashboard__eyebrow dashboard__eyebrow--light">GESTIÓN DIARIA</span><h2>Actividad y operaciones</h2></div>
        <p>Movimientos recientes y productos que necesitan atención.</p>
      </header>
      <div className="dashboard__details">
        <section className="card">
          <header className="dashboard__section-header">
            <div><span className="dashboard__eyebrow dashboard__eyebrow--light">ÚLTIMOS MOVIMIENTOS</span><h2>Actividad reciente</h2><p className="muted">Resumen diario de ventas.</p></div>
            <Link className="dashboard__text-link" to="/ventas">Todas <span aria-hidden="true">→</span></Link>
          </header>
          {sales.isError ? <p className="muted">No tienes acceso al reporte de ventas.</p> : (sales.data?.daily.length ?? 0) === 0 ? <p className="muted">Aún no hay ventas en este período.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Ventas</th><th>Total</th></tr></thead>
                <tbody>
                  {sales.data!.daily.slice(-7).reverse().map((day) => (
                    <tr key={day.day}>
                      <td>{day.day}</td><td>{day.salesCount}</td><td>{day.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card dashboard__stock-card">
          <header className="dashboard__section-header">
            <div><span className="dashboard__eyebrow dashboard__eyebrow--light">CONTROL DE STOCK</span><h2>Necesitan atención</h2><p className="muted">Productos que requieren reposición.</p></div>
            <Link className="dashboard__text-link" to="/inventario">Ver todo <span aria-hidden="true">→</span></Link>
          </header>
          {lowStock.isError ? <p className="muted">No tienes acceso al reporte de inventario.</p> : (lowStock.data?.length ?? 0) === 0 ? <p className="muted">No hay productos bajo su mínimo.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Producto</th><th>Existencias</th><th>Mínimo</th></tr></thead>
                <tbody>
                  {lowStock.data!.slice(0, 7).map((product) => (
                    <tr key={product.productId}>
                      <td><strong>{product.name}</strong><div className="muted">{product.sku}</div></td>
                      <td>{product.quantity}</td><td>{product.minStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
