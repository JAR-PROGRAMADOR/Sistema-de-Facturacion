import { useState } from 'react';
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

// Curva suave (Catmull-Rom → Bézier) para las gráficas de línea.
function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return '';
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function DashboardPage() {
  const { companyId, companies, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const from = dateInputValue(new Date(Date.now() - 29 * 86_400_000));
  const to = dateInputValue(new Date());
  const sales = useSalesSummary(companyId, isPlatform, from, to);
  const lowStock = useLowStock(companyId, isPlatform);
  const [stockQuery, setStockQuery] = useState('');
  const companyName = companies.find((company) => company.id === companyId)?.name;
  const chart = salesChartPoints(sales.data?.daily ?? []);
  const chartLabels = [0, 7, 14, 21, 29];
  const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const compactCurrency = (amount: number) => amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Variación frente a los 15 días anteriores, con los mismos datos cargados.
  const sum = (items: Array<{ total: number; salesCount: number }>, key: 'total' | 'salesCount') =>
    items.reduce((acc, item) => acc + item[key], 0);
  const deltaPct = (curr: number, prev: number): number | null =>
    prev > 0 ? ((curr - prev) / prev) * 100 : null;
  const formatDelta = (value: number | null) =>
    value === null
      ? '—'
      : `${value.toLocaleString(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })} %`;
  const revenueDelta = deltaPct(sum(chart.days.slice(15), 'total'), sum(chart.days.slice(0, 15), 'total'));
  const countDelta = deltaPct(sum(chart.days.slice(15), 'salesCount'), sum(chart.days.slice(0, 15), 'salesCount'));
  const deltaClass = (value: number | null) =>
    value === null ? 'dashboard__delta--flat' : value >= 0 ? 'dashboard__delta--up' : 'dashboard__delta--down';

  // Gráfica principal: línea de ingresos con área.
  const baselineY = chartHeight - chartPadding.bottom;
  const linePath = smoothPath(chart.days.map((point) => ({ x: point.x, y: point.y })));
  const areaPath = `${linePath} L ${chart.days[chart.days.length - 1]!.x} ${baselineY} L ${chart.days[0]!.x} ${baselineY} Z`;

  // Columna lateral: barras de ventas por día.
  const countMax = Math.max(1, ...chart.days.map((day) => day.salesCount));
  const sideWidth = 360;
  const sideHeight = 150;
  const sidePad = { top: 14, right: 10, bottom: 22, left: 34 };
  const sidePlotW = sideWidth - sidePad.left - sidePad.right;
  const sidePlotH = sideHeight - sidePad.top - sidePad.bottom;
  const sideBarW = (sidePlotW / chart.days.length) * 0.6;

  // Columna lateral: minigráfica de ingresos de los últimos 7 días.
  const lastWeek = chart.days.slice(-7);
  const lastWeekTotal = lastWeek.reduce((acc, day) => acc + day.total, 0);
  const sparkMax = Math.max(1, ...lastWeek.map((day) => day.total));
  const sparkW = 360;
  const sparkH = 90;
  const sparkPad = { top: 10, right: 6, bottom: 16, left: 34 };
  const sparkPlotW = sparkW - sparkPad.left - sparkPad.right;
  const sparkPlotH = sparkH - sparkPad.top - sparkPad.bottom;
  const sparkPoints = lastWeek.map((day, index) => ({
    x: sparkPad.left + (index / (lastWeek.length - 1)) * sparkPlotW,
    y: sparkPad.top + sparkPlotH - (day.total / sparkMax) * sparkPlotH,
  }));
  const sparkLine = smoothPath(sparkPoints);
  const sparkArea = `${sparkLine} L ${sparkPoints[sparkPoints.length - 1]!.x} ${sparkH - sparkPad.bottom} L ${sparkPoints[0]!.x} ${sparkH - sparkPad.bottom} Z`;

  // El buscador del encabezado filtra los productos que necesitan atención.
  const query = stockQuery.trim().toLowerCase();
  const filteredStock = (lowStock.data ?? []).filter(
    (product) => !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query),
  );

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
      <section className="dashboard__welcome">
        <div>
          <span className="dashboard__eyebrow"><span className="dashboard__live-dot" /> RESUMEN · ÚLTIMOS 30 DÍAS</span>
          <h1>{companyName ? `Bienvenido de nuevo, ${companyName}` : 'Bienvenido de nuevo'}</h1>
          <p>Ventas, actividad e inventario en un solo lugar.</p>
        </div>
        <div className="dashboard__welcome-actions">
          <label className="dashboard__search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={stockQuery}
              onChange={(event) => setStockQuery(event.target.value)}
              placeholder="Buscar en inventario…"
              aria-label="Buscar en inventario"
            />
          </label>
          <span className="dashboard__date">{dateFormatter.format(new Date())}</span>
          <Link className="dashboard__action" to="/ventas"><span aria-hidden="true">＋</span> Nueva venta</Link>
        </div>
      </section>

      {(sales.isError || lowStock.isError) && (
        <div className="dashboard__notice" role="status">
          {sales.isError && <p className="field__error">{sales.error instanceof ApiError ? sales.error.message : 'No se pudo cargar el resumen de ventas.'}</p>}
          {lowStock.isError && <p className="field__error">{lowStock.error instanceof ApiError ? lowStock.error.message : 'No se pudo cargar el resumen de inventario.'}</p>}
        </div>
      )}

      <section className="dashboard__metrics">
        <article className="dashboard__metric dashboard__metric--revenue">
          <div className="dashboard__metric-top"><span className="dashboard__metric-icon">↗</span><span className="dashboard__metric-period">30 DÍAS</span></div>
          <span className="dashboard__metric-label">Ingresos totales</span>
          <strong>{compactCurrency(sales.data?.total ?? 0)}</strong>
          <span className="dashboard__metric-foot">
            <span className={`dashboard__delta ${deltaClass(revenueDelta)}`}>{formatDelta(revenueDelta)}</span>
            <span className="dashboard__metric-note">vs. 15 días anteriores</span>
          </span>
        </article>
        <article className="dashboard__metric dashboard__metric--count">
          <div className="dashboard__metric-top"><span className="dashboard__metric-icon">▤</span><span className="dashboard__metric-period">ACTIVIDAD</span></div>
          <span className="dashboard__metric-label">Ventas realizadas</span>
          <strong>{sales.data?.salesCount ?? 0}</strong>
          <span className="dashboard__metric-foot">
            <span className={`dashboard__delta ${deltaClass(countDelta)}`}>{formatDelta(countDelta)}</span>
            <span className="dashboard__metric-note">vs. 15 días anteriores</span>
          </span>
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

      <div className="dashboard__charts">
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
                aria-label="Gráfica de línea de ingresos diarios de los últimos 30 días"
              >
                <defs>
                  <linearGradient id="sales-area-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#43d5a5" stopOpacity=".28" />
                    <stop offset="100%" stopColor="#43d5a5" stopOpacity="0" />
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
                <path d={areaPath} className="dashboard__chart-area" />
                <path d={linePath} className="dashboard__chart-line" />
                {chart.days.map((point) => (
                  <circle key={point.day} cx={point.x} cy={point.y} r="3" className="dashboard__chart-point">
                    <title>{`${point.day}: ${point.total.toFixed(2)} · ${point.salesCount} venta(s)`}</title>
                  </circle>
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

        <div className="dashboard__side">
          <section className="card dashboard__side-card">
            <header className="dashboard__section-header">
              <div>
                <span className="dashboard__eyebrow dashboard__eyebrow--light">VENTAS POR DÍA</span>
                <h2>Transacciones diarias</h2>
              </div>
              <div className="dashboard__side-total"><span>Total del período</span><strong>{sales.data?.salesCount ?? 0}</strong></div>
            </header>
            {sales.isError ? <p className="muted">No se pudo cargar la gráfica.</p> : (sales.data?.daily.length ?? 0) === 0 ? (
              <p className="muted">Aún no hay ventas en este período.</p>
            ) : (
              <div className="dashboard__chart-wrap">
                <svg
                  className="dashboard__chart"
                  viewBox={`0 0 ${sideWidth} ${sideHeight}`}
                  role="img"
                  aria-label="Gráfica de barras de ventas por día de los últimos 30 días"
                >
                  <defs>
                    <linearGradient id="sales-count-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#438dff" />
                      <stop offset="100%" stopColor="#438dff" stopOpacity=".35" />
                    </linearGradient>
                  </defs>
                  {[0, 1].map((step) => {
                    const y = sidePad.top + (sidePlotH / 1) * step;
                    const value = countMax * (1 - step);
                    return (
                      <g key={step}>
                        <line x1={sidePad.left} x2={sideWidth - sidePad.right} y1={y} y2={y} className="dashboard__chart-grid" />
                        <text x={sidePad.left - 8} y={y + 4} textAnchor="end" className="dashboard__chart-label">
                          {value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })}
                        </text>
                      </g>
                    );
                  })}
                  {chart.days.map((point, index) => {
                    const height = (point.salesCount / countMax) * sidePlotH;
                    return (
                      <g key={point.day}>
                        <rect
                          x={sidePad.left + (index / (chart.days.length - 1)) * sidePlotW - sideBarW / 2}
                          y={sidePad.top + sidePlotH - height}
                          width={sideBarW}
                          height={Math.max(point.salesCount > 0 ? 2 : 0, height)}
                          rx="2"
                          className="dashboard__chart-bar dashboard__chart-bar--count"
                        />
                        <title>{`${point.day}: ${point.salesCount} venta(s)`}</title>
                      </g>
                    );
                  })}
                  {[0, 14, 29].map((index) => (
                    <text
                      key={index}
                      x={sidePad.left + (index / (chart.days.length - 1)) * sidePlotW}
                      y={sideHeight - 6}
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

          <section className="card dashboard__side-card">
            <header className="dashboard__section-header">
              <div>
                <span className="dashboard__eyebrow dashboard__eyebrow--light">ÚLTIMOS 7 DÍAS</span>
                <h2>Ingresos recientes</h2>
              </div>
              <div className="dashboard__side-total"><span>Total 7 días</span><strong>{compactCurrency(lastWeekTotal)}</strong></div>
            </header>
            {sales.isError ? <p className="muted">No se pudo cargar la gráfica.</p> : (sales.data?.daily.length ?? 0) === 0 ? (
              <p className="muted">Aún no hay ventas en este período.</p>
            ) : (
              <div className="dashboard__chart-wrap">
                <svg
                  className="dashboard__spark"
                  viewBox={`0 0 ${sparkW} ${sparkH}`}
                  role="img"
                  aria-label="Minigráfica de ingresos de los últimos 7 días"
                >
                  <defs>
                    <linearGradient id="sales-spark-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#43d5a5" stopOpacity=".25" />
                      <stop offset="100%" stopColor="#43d5a5" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={sparkArea} className="dashboard__chart-area dashboard__chart-area--spark" />
                  <path d={sparkLine} className="dashboard__chart-line" />
                  {sparkPoints.map((point, index) => (
                    <circle key={lastWeek[index]!.day} cx={point.x} cy={point.y} r="2.5" className="dashboard__chart-point">
                      <title>{`${lastWeek[index]!.day}: ${lastWeek[index]!.total.toFixed(2)}`}</title>
                    </circle>
                  ))}
                  {[0, 6].map((index) => (
                    <text
                      key={index}
                      x={sparkPoints[index]!.x}
                      y={sparkH - 4}
                      textAnchor={index === 0 ? 'start' : 'end'}
                      className="dashboard__chart-label"
                    >
                      {dateFormatter.format(new Date(`${lastWeek[index]!.day}T00:00:00Z`))}
                    </text>
                  ))}
                </svg>
              </div>
            )}
          </section>
        </div>
      </div>

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
            <div><span className="dashboard__eyebrow dashboard__eyebrow--light">CONTROL DE STOCK</span><h2>Necesitan atención</h2><p className="muted">{query ? `${filteredStock.length} coincidencia(s) para «${stockQuery.trim()}»` : 'Productos que requieren reposición.'}</p></div>
            <Link className="dashboard__text-link" to="/inventario">Ver todo <span aria-hidden="true">→</span></Link>
          </header>
          {lowStock.isError ? <p className="muted">No tienes acceso al reporte de inventario.</p> : (lowStock.data?.length ?? 0) === 0 ? <p className="muted">No hay productos bajo su mínimo.</p> : filteredStock.length === 0 ? <p className="muted">Sin coincidencias para «{stockQuery.trim()}».</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Producto</th><th>Existencias</th><th>Mínimo</th></tr></thead>
                <tbody>
                  {filteredStock.slice(0, 7).map((product) => (
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
