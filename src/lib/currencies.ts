/** ISO 4217 currencies offered in the editor (code, display name, minor-unit digits). Digits follow ISO 4217:2015. */
export interface Currency {
  code: string;
  name: string;
  digits: number;
}

export const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', digits: 2 },
  { code: 'EUR', name: 'Euro', digits: 2 },
  { code: 'GBP', name: 'British Pound', digits: 2 },
  { code: 'CAD', name: 'Canadian Dollar', digits: 2 },
  { code: 'AUD', name: 'Australian Dollar', digits: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', digits: 2 },
  { code: 'CHF', name: 'Swiss Franc', digits: 2 },
  { code: 'JPY', name: 'Japanese Yen', digits: 0 },
  { code: 'CNY', name: 'Chinese Yuan', digits: 2 },
  { code: 'INR', name: 'Indian Rupee', digits: 2 },
  { code: 'SGD', name: 'Singapore Dollar', digits: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', digits: 2 },
  { code: 'KRW', name: 'South Korean Won', digits: 0 },
  { code: 'SEK', name: 'Swedish Krona', digits: 2 },
  { code: 'NOK', name: 'Norwegian Krone', digits: 2 },
  { code: 'DKK', name: 'Danish Krone', digits: 2 },
  { code: 'PLN', name: 'Polish Złoty', digits: 2 },
  { code: 'CZK', name: 'Czech Koruna', digits: 2 },
  { code: 'HUF', name: 'Hungarian Forint', digits: 2 },
  { code: 'RON', name: 'Romanian Leu', digits: 2 },
  { code: 'BGN', name: 'Bulgarian Lev', digits: 2 },
  { code: 'TRY', name: 'Turkish Lira', digits: 2 },
  { code: 'ZAR', name: 'South African Rand', digits: 2 },
  { code: 'BRL', name: 'Brazilian Real', digits: 2 },
  { code: 'MXN', name: 'Mexican Peso', digits: 2 },
  { code: 'ARS', name: 'Argentine Peso', digits: 2 },
  { code: 'CLP', name: 'Chilean Peso', digits: 0 },
  { code: 'COP', name: 'Colombian Peso', digits: 2 },
  { code: 'PEN', name: 'Peruvian Sol', digits: 2 },
  { code: 'AED', name: 'UAE Dirham', digits: 2 },
  { code: 'SAR', name: 'Saudi Riyal', digits: 2 },
  { code: 'QAR', name: 'Qatari Riyal', digits: 2 },
  { code: 'KWD', name: 'Kuwaiti Dinar', digits: 3 },
  { code: 'BHD', name: 'Bahraini Dinar', digits: 3 },
  { code: 'ILS', name: 'Israeli New Shekel', digits: 2 },
  { code: 'EGP', name: 'Egyptian Pound', digits: 2 },
  { code: 'NGN', name: 'Nigerian Naira', digits: 2 },
  { code: 'KES', name: 'Kenyan Shilling', digits: 2 },
  { code: 'GHS', name: 'Ghanaian Cedi', digits: 2 },
  { code: 'MAD', name: 'Moroccan Dirham', digits: 2 },
  { code: 'PKR', name: 'Pakistani Rupee', digits: 2 },
  { code: 'BDT', name: 'Bangladeshi Taka', digits: 2 },
  { code: 'LKR', name: 'Sri Lankan Rupee', digits: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', digits: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', digits: 2 },
  { code: 'PHP', name: 'Philippine Peso', digits: 2 },
  { code: 'THB', name: 'Thai Baht', digits: 2 },
  { code: 'VND', name: 'Vietnamese Đồng', digits: 0 },
  { code: 'TWD', name: 'New Taiwan Dollar', digits: 2 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', digits: 2 },
  { code: 'ISK', name: 'Icelandic Króna', digits: 0 },
];

const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));

export function findCurrency(code: string): Currency | undefined {
  return byCode.get(code.toUpperCase());
}

export function isKnownCurrency(code: string): boolean {
  return byCode.has(code.toUpperCase());
}

/** Number-format locales offered in the editor (affects separators and symbol position only). */
export const LOCALES: { code: string; name: string }[] = [
  { code: 'en-US', name: 'English (US) 1,234.56' },
  { code: 'en-GB', name: 'English (UK) 1,234.56' },
  { code: 'en-IN', name: 'English (India) 1,23,456.78' },
  { code: 'de-DE', name: 'Deutsch 1.234,56' },
  { code: 'fr-FR', name: 'Français 1 234,56' },
  { code: 'es-ES', name: 'Español 1.234,56' },
  { code: 'it-IT', name: 'Italiano 1.234,56' },
  { code: 'nl-NL', name: 'Nederlands 1.234,56' },
  { code: 'pt-BR', name: 'Português (BR) 1.234,56' },
  { code: 'pl-PL', name: 'Polski 1 234,56' },
  { code: 'sv-SE', name: 'Svenska 1 234,56' },
  { code: 'ja-JP', name: '日本語 1,234' },
];

export function isKnownLocale(code: string): boolean {
  return LOCALES.some((l) => l.code === code);
}
