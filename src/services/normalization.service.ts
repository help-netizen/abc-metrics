export class NormalizationService {
    /**
     * Normalize phone number to digits-only string.
     * For US numbers, it will be 10 digits (removes leading 1 if 11 digits).
     */
    static phone(phone: string | null | undefined): string | null {
        if (!phone) return null;

        // Remove all non-digit characters
        let digits = phone.replace(/\D/g, '');

        if (!digits) return null;

        // Handle US country code: if 11 digits and starts with 1, remove the 1
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        return digits;
    }

    /**
     * Normalize ZIP code to 5-digit string.
     * Strips non-digits, takes first 5, and pads with leading zeros if necessary.
     */
    static zip(zip: string | null | undefined): string | null {
        if (!zip) return null;

        // Remove all non-digit characters
        let digits = zip.replace(/\D/g, '');

        if (!digits) return null;

        // Take only first 5 digits (handles ZIP+4)
        if (digits.length > 5) {
            digits = digits.substring(0, 5);
        }

        // Pad with leading zeros if less than 5 digits
        if (digits.length < 5) {
            digits = digits.padStart(5, '0');
        }

        return digits;
    }

    /**
     * Normalize date/time to ISO-8601 string.
     * @param input Raw date input (string, number, or Date)
     * @returns ISO-8601 string or null if invalid
     */
    static dateTime(input: any): string | null {
        if (!input) return null;

        try {
            const date = new Date(input);
            if (isNaN(date.getTime())) {
                return null;
            }
            return date.toISOString();
        } catch (e) {
            return null;
        }
    }

    /**
     * Normalize date to YYYY-MM-DD format.
     */
    static date(input: any): string | null {
        const isoString = this.dateTime(input);
        if (!isoString) return null;
        return isoString.split('T')[0];
    }

    /**
     * Normalize text (trim)
     */
    static trimString(str: string | null | undefined): string | null {
        if (!str) return null;
        return str.trim();
    }
}
