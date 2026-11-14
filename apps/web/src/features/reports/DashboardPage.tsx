import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiError } from '../../shared/api/error';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useLowStock, useSalesSummary } from './api';

const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);

interface ChartDay {
  day: string;
  label: string;
  total: number;
  cost: number;
  profit: number;
  salesCount: number;
}

// Serie diaria de 30 días (los días sin ventas quedan en cero).
function buildChartDays(
  daily: Array<{ day: string; salesCount: number; total: number; cost: number }>,
  labelFmt: Intl.DateTimeFormat,
): ChartDay[] {
  const end = new Date(`${dateInputValue(new Date())}T00:00:00Z`);
  const values = new Map(daily.map((item) => [item.day, item]));
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (29 - index));
    const day = date.toISOString().slice(0, 10);
    const item = values.get(day);
    const total = item?.total ?? 0;
    const cost = item?.cost ?? 0;
    return {
      day,
      label: labelFmt.format(date),
      total,
      cost,
      profit: total - cost,
      salesCount: item?.salesCount ?? 0,
    };
  });
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: ChartDay;
}

function ChartTooltip({ active, payload, format }: {
  active?: boolean;
  payload?: TooltipEntry[];
  format: (amount: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  return (
    <div className="dashboard__tooltip">
      <span className="dashboard__tooltip-date">{datum?.day ?? ''}</span>
      {payload.map((entry) => (
        <span key={entry.name} className="dashboard__tooltip-row">
          <i style={{ background: entry.color ?? '#438dff' }} />
          {entry.name}
          <strong>{format(Number(entry.value ?? 0))}</strong>
        </span>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { companyId, companies, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const from = dateInputValue(new Date(Date.now() - 29 * 86_400_000));
  const to = dateInputValue(new Date());
  const sales = useSalesSummary(companyId, isPlatform, from, to);
  const lowStock = useLowStock(companyId, isPlatform);
  const [stockQuery, setStockQuery] = useState('');
  const companyName = companies.find((company) => company.id === companyId)?.name;
  const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const compactCurrency = (amount: number) => amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const compactNumber = (value: number) => value.toLocaleString(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  const days = buildChartDays(sales.data?.daily ?? [], dateFormatter);
  const lastWeek = days.slice(-7);
  const lastWeekTotal = lastWeek.reduce((acc, day) => acc + day.total, 0);
  const maxDay = days.reduce((best, day) => (day.total > best.total ? day : best), days[0]!);

  // Variación frente a los 15 días anteriores, con los mismos datos cargados.
  const sum = (items: ChartDay[], key: 'total' | 'salesCount') =>
    items.reduce((acc, item) => acc + item[key], 0);
  const deltaPct = (curr: number, prev: number): number | null =>
    prev > 0 ? ((curr - prev) / prev) * 100 : null;
  const formatDelta = (value: number | null) =>
    value === null
      ? '—'
      : `${value.toLocaleString(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })} %`;
  const revenueDelta = deltaPct(sum(days.slice(15), 'total'), sum(days.slice(0, 15), 'total'));
  const countDelta = deltaPct(sum(days.slice(15), 'salesCount'), sum(days.slice(0, 15), 'salesCount'));
  const deltaClass = (value: number | null) =>
    value === null ? 'dashboard__delta--flat' : value >= 0 ? 'dashboard__delta--up' : 'dashboard__delta--down';

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

      <div className="dashboard__frame">
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
          <div className="dashboard__chart-legend">
            <span><i className="dashboard__legend-dot dashboard__legend-dot--revenue" /> Ingresos</span>
            <span><i className="dashboard__legend-dot dashboard__legend-dot--cost" /> Costos</span>
            <span className="muted">Últimos 30 días</span>
          </div>
          {sales.isError ? <p className="muted">No se pudo cargar la gráfica de ventas.</p> : (sales.data?.daily.length ?? 0) === 0 ? (
            <div className="dashboard__chart-empty">
              <span aria-hidden="true">↗</span>
              <p>Aún no hay ventas en este período.</p>
              <Link to="/ventas">Registra la primera venta</Link>
            </div>
          ) : (
            <div className="dashboard__chart-wrap">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#438dff" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#438dff" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="costFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#43d5a5" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#43d5a5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#252d37" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#7c8999', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    interval={4}
                  />
                  <YAxis
                    tickFormatter={compactNumber}
                    tick={{ fill: '#7c8999', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    domain={[0, (dataMax: number) => dataMax * 1.15]}
                  />
                  <Tooltip content={<ChartTooltip format={compactCurrency} />} cursor={{ stroke: '#3a4552', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="total" name="Ingresos" stroke="#438dff" strokeWidth={2.5} fill="url(#revenueFill)" dot={false} activeDot={{ r: 4, fill: '#11161d', stroke: '#438dff', strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="cost" name="Costos" stroke="#43d5a5" strokeWidth={2.5} fill="url(#costFill)" dot={false} activeDot={{ r: 4, fill: '#11161d', stroke: '#43d5a5', strokeWidth: 2 }} />
                  {maxDay.total > 0 && (
                    <ReferenceDot
                      x={maxDay.label}
                      y={maxDay.total}
                      r={4}
                      fill="#11161d"
                      stroke="#438dff"
                      strokeWidth={2}
                      label={{ value: compactCurrency(maxDay.total), fill: '#eaf0f8', fontSize: 12, fontWeight: 700, position: 'top' }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <div className="dashboard__side">
          <section className="card dashboard__side-card">
            <header className="dashboard__section-header">
              <div>
                <span className="dashboard__eyebrow dashboard__eyebrow--light">UTILIDAD BRUTA</span>
                <h2>Ganancia por día</h2>
              </div>
              <div className="dashboard__side-total"><span>Total del período</span><strong>{compactCurrency(sales.data?.grossProfit ?? 0)}</strong></div>
            </header>
            {sales.isError ? <p className="muted">No se pudo cargar la gráfica.</p> : (sales.data?.daily.length ?? 0) === 0 ? (
              <p className="muted">Aún no hay ventas en este período.</p>
            ) : (
              <div className="dashboard__chart-wrap">
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={days} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <defs>
                      <linearGradient id="profitFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#438dff" />
                        <stop offset="100%" stopColor="#438dff" stopOpacity={0.35} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#7c8999', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      interval={14}
                    />
                    <YAxis hide domain={[0, (dataMax: number) => dataMax * 1.1]} />
                    <Tooltip content={<ChartTooltip format={compactCurrency} />} cursor={{ fill: 'rgba(67, 141, 255, 0.07)' }} />
                    <Bar dataKey="profit" name="Utilidad" fill="url(#profitFill)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={lastWeek} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#43d5a5" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#43d5a5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#7c8999', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis hide domain={[0, (dataMax: number) => dataMax * 1.15]} />
                    <Tooltip content={<ChartTooltip format={compactCurrency} />} cursor={{ stroke: '#3a4552', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="total" name="Ingresos" stroke="#43d5a5" strokeWidth={2.5} fill="url(#sparkFill)" dot={false} activeDot={{ r: 3.5, fill: '#11161d', stroke: '#43d5a5', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
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
    </div>
  );
}
