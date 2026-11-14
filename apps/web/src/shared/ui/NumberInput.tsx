import { useEffect, useState } from 'react';

/**
 * Campo numérico sin el problema del `type="number"` controlado con un
 * `number` en el estado: al borrar el 0, `Number('')` devolvía 0 y React
 * volvía a poner el 0, así que nunca se podía escribir 123 (salía 0123).
 *
 * Este componente guarda el texto mientras se escribe y solo avisa al
 * padre con el número ya limpio:
 * - Se puede borrar todo el contenido y escribir de cero.
 * - No entran letras ni el signo menos (tampoco la `e` de `type="number"`).
 * - Los ceros a la izquierda se quitan al teclear: 0123 pasa a 123.
 * - La coma se acepta como separador decimal y se normaliza a punto.
 * - Al salir del campo, un valor vacío vuelve al mínimo (0 por defecto)
 *   salvo que `allowEmpty` sea true, en cuyo caso queda vacío.
 */
interface NumberInputProps {
  value: number | null | undefined;
  onValueChange: (value: number | undefined) => void;
  /** Decimales permitidos (0 = entero). Por defecto 2. */
  decimals?: number;
  /** Valor mínimo (también es el valor al que vuelve un campo vacío). Por defecto 0. */
  min?: number;
  max?: number;
  /** Si es true, al salir del campo un valor vacío se queda vacío. */
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
}

function formatValue(value: number | null | undefined): string {
  return value === undefined || value === null ? '' : String(value);
}

/** Limpia lo tecleado: solo dígitos y un punto decimal, sin ceros a la izquierda. */
export function sanitizeNumberInput(raw: string, decimals: number): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  if (cleaned === '') return '';
  const dot = cleaned.indexOf('.');
  let int = dot === -1 ? cleaned : cleaned.slice(0, dot);
  let frac = dot === -1 ? '' : cleaned.slice(dot + 1).replace(/\./g, '');
  if (decimals === 0) {
    frac = '';
  } else if (frac.length > decimals) {
    frac = frac.slice(0, decimals);
  }
  int = int.replace(/^0+/, '');
  if (int === '') int = '0';
  if (frac === '') return dot === -1 ? int : `${int}.`;
  return `${int}.${frac}`;
}

export function NumberInput({
  value,
  onValueChange,
  decimals = 2,
  min = 0,
  max,
  allowEmpty = false,
  placeholder,
  className,
  style,
  disabled,
  autoFocus,
  'aria-label': ariaLabel,
}: NumberInputProps) {
  const [text, setText] = useState(() => formatValue(value));
  const [focused, setFocused] = useState(false);

  // Mientras se escribe no se toca el texto; al salir del foco (o cuando el
  // padre cambia el valor desde fuera, p. ej. al resetear un formulario)
  // se sincroniza con el valor numérico.
  useEffect(() => {
    if (!focused) setText(formatValue(value));
  }, [value, focused]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeNumberInput(event.target.value, decimals);
    setText(next);
    onValueChange(next === '' || next === '.' ? undefined : Number(next));
  };

  const handleBlur = () => {
    setFocused(false);
    if (text === '' || text === '.') {
      if (allowEmpty) {
        onValueChange(undefined);
        return;
      }
      setText(String(min));
      onValueChange(min);
      return;
    }
    let parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setText(String(min));
      onValueChange(min);
      return;
    }
    if (parsed < min) parsed = min;
    if (max !== undefined && parsed > max) parsed = max;
    setText(String(parsed));
    onValueChange(parsed);
  };

  return (
    <input
      className={['input', className].filter(Boolean).join(' ')}
      style={style}
      type="text"
      inputMode={decimals === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={handleChange}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    />
  );
}
