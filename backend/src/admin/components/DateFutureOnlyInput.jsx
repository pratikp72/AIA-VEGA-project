import React from 'react';
import { useIntl } from 'react-intl';

/**
 * Date picker that only allows selecting today or future dates.
 * Used for News "Publish date" to prevent past dates.
 */
const DateFutureOnlyInput = React.forwardRef((props, ref) => {
  const {
    attribute,
    description,
    disabled,
    intlLabel,
    name,
    onChange,
    required,
    value,
    error,
  } = props;

  const { formatMessage } = useIntl();

  // Min date: today in local date string (YYYY-MM-DD)
  const today = new Date();
  const minDate = today.toISOString().slice(0, 10);

  // Value: content-manager may pass ISO string or null
  const displayValue = value && typeof value === 'string' ? value.slice(0, 10) : value ?? '';

  const handleChange = (e) => {
    const next = e.target.value || undefined;
    onChange({
      target: { name, type: attribute?.type ?? 'date', value: next || null },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor={name} style={{ fontWeight: 500, fontSize: 14 }}>
        {formatMessage(intlLabel)}
        {required && ' *'}
      </label>
      <input
        ref={ref}
        id={name}
        type="date"
        name={name}
        value={displayValue}
        min={minDate}
        disabled={disabled}
        required={required}
        onChange={handleChange}
        aria-invalid={error ? true : undefined}
        style={{
          padding: '8px 12px',
          border: `1px solid ${error ? '#d02b20' : '#dcdce4'}`,
          borderRadius: 4,
          fontSize: 14,
          width: '100%',
          maxWidth: 240,
        }}
      />
      {description && (
        <span style={{ fontSize: 12, color: '#666' }}>
          {formatMessage(description)}
        </span>
      )}
      {error && (
        <span style={{ fontSize: 12, color: '#d02b20' }}>
          {formatMessage(error)}
        </span>
      )}
    </div>
  );
});

DateFutureOnlyInput.displayName = 'DateFutureOnlyInput';

export default DateFutureOnlyInput;
