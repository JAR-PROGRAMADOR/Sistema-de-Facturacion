import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={['input', className].filter(Boolean).join(' ')}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';