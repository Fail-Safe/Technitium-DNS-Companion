import { forwardRef, type ComponentProps } from "react";

/**
 * Drop-in replacement for <input> with sensible defaults for a technical
 * DNS configuration tool: auto-capitalize and spell-check disabled.
 *
 * All props are forwarded and can override the defaults, e.g.:
 *   <AppInput spellCheck={true} />  // re-enable for a notes field
 */
export const AppInput = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  function AppInput(props, ref) {
    return (
      <input ref={ref} autoCapitalize="none" spellCheck={false} {...props} />
    );
  },
);

/**
 * Drop-in replacement for <textarea> with the same defaults as AppInput.
 */
export const AppTextarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<"textarea">
>(function AppTextarea(props, ref) {
  return (
    <textarea ref={ref} autoCapitalize="none" spellCheck={false} {...props} />
  );
});
