import { useEffect, useRef } from 'react';

/**
 * Hook to automatically scroll to the first error field when validation fails.
 * Searches for MUI error components and custom data-error attributes.
 *
 * @param errors - Object containing error messages keyed by field name
 */
export function useScrollToError(errors: Record<string, string>) {
  const previousErrorsRef = useRef<Record<string, string>>(errors);

  useEffect(() => {
    const hasErrors = Object.keys(errors).length > 0;
    const isNewErrorsObject = errors !== previousErrorsRef.current;

    if (hasErrors && isNewErrorsObject) {
      // Small delay to ensure DOM has updated with error states
      requestAnimationFrame(() => {
        const selectors = [
          '.Mui-error',
          '[data-error="true"]',
          '.MuiTypography-root.MuiTypography-colorError',
        ];

        let errorElement: HTMLElement | null = null;
        for (const selector of selectors) {
          errorElement = document.querySelector(selector) as HTMLElement;
          if (errorElement) break;
        }

        if (errorElement) {
          const fieldContainer =
            errorElement.closest('.MuiFormControl-root') ||
            errorElement.parentElement ||
            errorElement;

          const elementRect = fieldContainer.getBoundingClientRect();
          const absoluteTop = window.pageYOffset + elementRect.top;

          window.scrollTo({
            top: Math.max(0, absoluteTop - 100),
            behavior: 'smooth',
          });

          // Focus the input after scroll
          const focusableInput = fieldContainer.querySelector(
            'input:not([type="hidden"]), textarea, select'
          ) as HTMLElement;

          if (focusableInput) {
            setTimeout(() => focusableInput.focus(), 300);
          }
        }
      });
    }

    previousErrorsRef.current = errors;
  }, [errors]);
}

export default useScrollToError;
