import { Response } from 'express';
import sanitizeHtml from 'sanitize-html';

export interface ValidationOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  required?: boolean;
}

/**
 * Validates a string based on the provided options.
 * Returns an error message if invalid, or null if valid.
 */
export const validateString = (value: any, label: string, options: ValidationOptions = {}): string | null => {
  if (options.required && (value === undefined || value === null || value === '')) {
    return `${label} is required.`;
  }

  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return `${label} must be a string.`;
  }

  if (options.minLength && value.length < options.minLength) {
    return `${label} must be at least ${options.minLength} characters.`;
  }

  if (options.maxLength && value.length > options.maxLength) {
    return `${label} must be at most ${options.maxLength} characters.`;
  }

  if (options.pattern && !options.pattern.test(value)) {
    return `${label} format is invalid.`;
  }

  return null;
};

/**
 * Sanitizes a string using sanitize-html to prevent XSS.
 */
export const sanitize = (value: string): string => {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  });
};

/**
 * Standardized error response for validation failures.
 */
export const handleValidationError = (res: Response, errors: string[]) => {
  console.warn(`[ValidationFailure]: ${errors.join('; ')}`);
  return res.status(400).json({ 
    error: 'Validation failed', 
    details: errors 
  });
};
