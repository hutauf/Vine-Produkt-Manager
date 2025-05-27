
// utils/dateUtils.ts

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
        const day = String(isoDateCandidate.getDate()).padStart(2, '0');
        const month = String(isoDateCandidate.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
        const year = isoDateCandidate.getFullYear();
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
        const testDate = new Date(year, month - 1, day); // month - 1 for Date constructor (0-indexed)
        if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
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

    const date = new Date(year, month, day);
    // Additional check to ensure the date wasn't "corrected" by the Date constructor (e.g. Feb 30 -> Mar 2)
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
        return date;
    }
    return null;
};
