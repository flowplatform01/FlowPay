export function normalizePhoneNumber(value?: string | null) {
  if (!value) {
    return value;
  }

  const compact = value.trim().replace(/[\s().-]+/g, "");
  if (!compact) {
    return undefined;
  }

  if (compact.startsWith("+")) {
    return compact;
  }

  if (compact.startsWith("00")) {
    return `+${compact.slice(2)}`;
  }

  if (compact.startsWith("237")) {
    return `+${compact}`;
  }

  if (/^6\d{8}$/.test(compact)) {
    return `+237${compact}`;
  }

  return compact;
}
