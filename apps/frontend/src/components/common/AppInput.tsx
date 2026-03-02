import type { ComponentProps } from "react";

/**
 * Drop-in replacement for <input> with sensible defaults for a technical
 * DNS configuration tool: auto-capitalize and spell-check disabled.
 *
 * All props are forwarded and can override the defaults, e.g.:
 *   <AppInput spellCheck={true} />  // re-enable for a notes field
 */
export function AppInput(props: ComponentProps<"input">) {
  return <input autoCapitalize="none" spellCheck={false} {...props} />;
}

/**
 * Drop-in replacement for <textarea> with the same defaults as AppInput.
 */
export function AppTextarea(props: ComponentProps<"textarea">) {
  return <textarea autoCapitalize="none" spellCheck={false} {...props} />;
}
