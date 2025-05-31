// utils/dateUtils.ts
import { Product, EuerSettings } from '../types'; // Added EuerSettings

/**
 * Tries to parse a date string and normalize it to DD/MM/YYYY format.
 * Handles ISO 8601 strings, DD/MM/YYYY, DD.MM.YYYY, and D.M.YYYY variations.
 * @param dateString The date string to normalize.
 * @param fieldName Optional field name for logging.
 * @param asin Optional ASIN for logging.
 * @returns The date string in DD/MM/YYYY format, or '01/01/1970' if it cannot be reliably converted.
 */
export const normalizeDateString = (dateString: string | undefined, fieldName: string = 'date', asin?: string): string => {
  if (!dateString || typeof dateString !== 'string' || dateString.trim() === '') {
    // console.warn(`Invalid or missing ${fieldName} provided for ASIN ${asin || 'N/A'}: '${dateString}'. Using fallback.`);
    return '01/01/1970';
  }

  // 1. Try parsing as ISO 8601 date (YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DD)
  const isoDateCandidate = new Date(dateString);
  // Check if it looks like an ISO date and parses to a valid date.
  // dateString.length > 10 is a loose check for YYYY-MM-DDTHH...
  const looksLikeISO = dateString.includes('T') || dateString.includes('Z') || (dateString.includes('-') && dateString.split('-').length === 3);

  if (looksLikeISO && !isNaN(isoDateCandidate.getTime())) {
    // Further check: if original string doesn't have '-', it might be a misinterpretation by Date constructor
    // e.g. "01/05/2024" might be parsed by new Date() but isn't ISO.
    // Also check if the year is plausible (e.g. not 1970 if original clearly wasn't)
     if (isoDateCandidate.getFullYear() >= 1900 && isoDateCandidate.getFullYear() <= 2200) { // Reasonable year range
        const day = String(isoDateCandidate.getUTCDate()).padStart(2, '0'); // Use UTCDate
        const month = String(isoDateCandidate.getUTCMonth() + 1).padStart(2, '0'); // Month is 0-indexed, use UTCMonth
        const year = isoDateCandidate.getUTCFullYear(); // Use getUTCFullYear
        return `${day}/${month}/${year}`;
     }
  }

  // 2. Try parsing DD/MM/YYYY, DD.MM.YYYY, D/M/YYYY, D.M.YYYY etc.
  // Regex to capture day, month, year with / or . as separator, allowing 1 or 2 digits for day/month
  const dmyRegex = /^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/;
  const match = dateString.match(dmyRegex);

  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10); // month is 1-based from regex
    const year = parseInt(match[3], 10);

    // Validate as a real calendar date
    if (year >= 1900 && year <= 2200 && month >= 1 && month <= 12) {
        const testDate = new Date(Date.UTC(year, month - 1, day)); // month - 1 for Date constructor (0-indexed), Use UTC
        if (testDate.getUTCFullYear() === year && testDate.getUTCMonth() === month - 1 && testDate.getUTCDate() === day) {
            return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
        } else {
            console.warn(`Invalid calendar date for ${fieldName} (parsed as D.M.Y) for ASIN ${asin || 'N/A'}: ${dateString}. Date components: D=${day}, M=${month}, Y=${year}. Using fallback.`);
            return '01/01/1970';
        }
    } else {
        console.warn(`Invalid date components for ${fieldName} (parsed as D.M.Y) for ASIN ${asin || 'N/A'}: ${dateString}. D=${day}, M=${month}, Y=${year}. Using fallback.`);
        return '01/01/1970';
    }
  }
  
  console.warn(`Unrecognized ${fieldName} format for ASIN ${asin || 'N/A'}: "${dateString}". Expected ISO, DD/MM/YYYY, or DD.MM.YYYY. Using fallback.`);
  return '01/01/1970';
};

/**
 * Parses a date string in DD/MM/YYYY format to a Date object.
 * @param dateStr The date string to parse.
 * @returns A Date object or null if parsing fails.
 */
export const parseDMYtoDate = (dateStr: string): Date | null => {
    if (!dateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        return null;
    }
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const year = parseInt(parts[2], 10);
    
    // Check year range if necessary, e.g., year >= 1900 && year <= 2200
    if (year < 1900 || year > 2200) return null;

    const date = new Date(Date.UTC(year, month, day)); // Use UTC to avoid timezone issues with Date objects
    // Additional check to ensure the date wasn't "corrected" by the Date constructor (e.g. Feb 30 -> Mar 2)
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
        return date;
    }
    return null;
};


/**
 * Parses a German date string (TT.MM.JJJJ) to a Date object.
 * @param dateStr The date string to parse.
 * @returns A Date object or null if parsing fails.
 */
export const parseGermanDate = (dateStr?: string): Date | null => {
  if (!dateStr) return null;
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
    return null; 
  }
  const parts = dateStr.split('.');
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) -1; // Month is 0-indexed
  const year = parseInt(parts[2], 10);

  if (year < 1900 || year > 2100 || month < 0 || month > 11) {
    return null;
  }
  const date = new Date(Date.UTC(year, month, day)); // Use UTC
  // Check if date object is valid and matches input (e.g. 30.02.2023 is invalid)
  if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
    return date;
  }
  return null;
};

/**
 * Normalizes a user-entered German date string (ideally TT.MM.JJJJ) to a consistent TT.MM.JJJJ format.
 * Attempts to correct shorthand like D.M.YY or D.M.YYYY.
 * Returns the original string if it cannot be reliably normalized or is invalid.
 * @param dateString The date string from user input.
 * @returns A normalized TT.MM.JJJJ string, or the original string if normalization fails.
 */
export const normalizeGermanDateInput = (dateString?: string): string => {
  if (!dateString || typeof dateString !== 'string') return '';
  const cleanStr = dateString.trim();

  if (cleanStr === '') return '';

  // Try to match variations: D.M.YY, DD.M.YY, D.MM.YY, DD.MM.YY, D.M.YYYY, DD.M.YYYY, D.MM.YYYY, DD.MM.YYYY
  const generalMatch = cleanStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);

  if (generalMatch) {
    let day = generalMatch[1];
    let month = generalMatch[2];
    let yearStr = generalMatch[3];

    if (yearStr.length === 2) {
      const currentYear = new Date().getFullYear();
      const twoDigitYear = parseInt(yearStr, 10);
      // Assuming 'YY' refers to current century, or previous if it results in a future date far off
      // A common simple heuristic: if yy < (currentYear % 100) + 10 (e.g. < 34 for 2024), assume 20yy, else 19yy
      // Or simpler: years 00-69 are 20xx, 70-99 are 19xx
      yearStr = (twoDigitYear < 70 ? 2000 + twoDigitYear : 1900 + twoDigitYear).toString();
    }
    
    const formattedDate = `${day.padStart(2, '0')}.${month.padStart(2, '0')}.${yearStr}`;
    
    if (parseGermanDate(formattedDate)) { // parseGermanDate validates if it's a real calendar date
      return formattedDate;
    } else {
      // If constructed date is invalid (e.g., 30.02.2024), return original to let user fix
      return cleanStr; 
    }
  }
  
  // If it's already in TT.MM.JJJJ format, check if it's a valid date
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(cleanStr)) {
    if (parseGermanDate(cleanStr)) {
      return cleanStr;
    }
  }

  // Return original string if it doesn't match expected patterns or is invalid
  return cleanStr; 
};


/**
 * Converts a German date string (TT.MM.JJJJ) to ISO format (YYYY-MM-DD).
 * Returns an empty string if the German date is invalid.
 */
export const convertGermanToISO = (germanDate?: string): string => {
  if (!germanDate) return '';
  const dateObj = parseGermanDate(germanDate); // Use parseGermanDate which expects TT.MM.JJJJ
  if (dateObj) {
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return ''; // Return empty if input is invalid, so date input field can be empty
};

/**
 * Converts an ISO date string (YYYY-MM-DD) to German format (TT.MM.JJJJ).
 * Returns an empty string if the ISO date is invalid.
 */
export const convertISOToGerman = (isoDate?: string): string => {
  if (!isoDate) return '';
  // Basic regex for YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return ''; 

  const parts = isoDate.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed for Date constructor
  const day = parseInt(parts[2], 10);

  const dateObj = new Date(Date.UTC(year, month, day));
  if (dateObj.getUTCFullYear() === year && dateObj.getUTCMonth() === month && dateObj.getUTCDate() === day) {
    return `${String(day).padStart(2, '0')}.${String(month + 1).padStart(2, '0')}.${year}`;
  }
  return ''; // If the ISO date is not a valid calendar date (e.g., 2023-02-30)
};

/**
 * Gets today's date formatted as TT.MM.JJJJ.
 */
export const getTodayGermanFormat = (): string => {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
  const year = today.getFullYear();
  return `${day}.${month}.${year}`;
};

/**
 * Formats a Date object to a German date string (TT.MM.JJJJ).
 * @param date The Date object to format.
 * @returns A string in TT.MM.JJJJ format.
 */
export const formatDateToGermanDDMMYYYY = (date: Date): string => {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0'); // Month is 0-indexed
  const year = date.getUTCFullYear();
  return `${day}.${month}.${year}`;
};


/**
 * Adds a specified number of days to a Date object.
 * @param date The starting Date object.
 * @param days The number of days to add (can be negative).
 * @returns A new Date object with the days added.
 */
const addDaysToDate = (date: Date, days: number): Date => {
  const result = new Date(date.getTime()); // Clone the date
  result.setUTCDate(result.getUTCDate() + days); // Use UTCDate for consistency
  return result;
};

/**
 * Calculates the effective private withdrawal date for a product.
 * Uses product.privatentnahmeDate if set, otherwise calculates based on order date and default delay.
 * @param product The product.
 * @param settings The EÜR settings containing defaultPrivatentnahmeDelay.
 * @returns A Date object for the effective private withdrawal, or null if dates are invalid.
 */
export const getEffectivePrivatentnahmeDate = (product: Product, settings: EuerSettings): Date | null => {
  if (product.privatentnahmeDate) {
    const explicitDate = parseGermanDate(product.privatentnahmeDate);
    if (explicitDate) return explicitDate;
  }

  const orderDate = parseDMYtoDate(product.date); // This expects DD/MM/YYYY
  if (!orderDate) return null; // If orderDate is invalid, cannot calculate effective date

  const delayString = settings.defaultPrivatentnahmeDelay; // e.g., "0d", "7d", "14d", "90d"
  const daysMatch = delayString.match(/^(\d+)d$/);
  
  if (daysMatch && daysMatch[1]) {
    const days = parseInt(daysMatch[1], 10);
    return addDaysToDate(orderDate, days);
  }
  
  // Fallback or handle other delay units if added in the future
  return orderDate; // Default to orderDate if delay string is unrecognized
};

/**
 * Calculates the end of the quarter for a given date.
 * @param date The input date.
 * @returns A Date object representing the last day of the quarter.
 */
export const getEndOfQuarter = (date: Date): Date => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed

  let endMonth, endDay;
  if (month <= 2) { // Q1 (Jan, Feb, Mar) -> Mar is month 2
    endMonth = 2; endDay = 31;
  } else if (month <= 5) { // Q2 (Apr, May, Jun) -> Jun is month 5
    endMonth = 5; endDay = 30;
  } else if (month <= 8) { // Q3 (Jul, Aug, Sep) -> Sep is month 8
    endMonth = 8; endDay = 30;
  } else { // Q4 (Oct, Nov, Dec) -> Dec is month 11
    endMonth = 11; endDay = 31;
  }
  return new Date(Date.UTC(year, endMonth, endDay));
};

/**
 * Finds the oldest order date among unfinalized products.
 * @param products Array of products.
 * @returns The oldest date as a Date object, or null if no suitable products exist.
 */
export const getOldestUnfinalizedProductDate = (products: Product[]): Date | null => {
  let oldestDate: Date | null = null;
  for (const p of products) {
    if (p.festgeschrieben !== 1) {
      const orderDate = parseDMYtoDate(p.date);
      if (orderDate) {
        if (!oldestDate || orderDate < oldestDate) {
          oldestDate = orderDate;
        }
      }
    }
  }
  return oldestDate;
};