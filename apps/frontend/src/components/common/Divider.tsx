import React from 'react';

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
    decorative?: boolean; // hide from assistive tech by default
    compact?: boolean; // smaller vertical spacing
}

export function Divider({ decorative = true, compact = false, className = '', ...rest }: DividerProps) {
    const classes = `divider ${compact ? 'divider--compact' : ''} ${className}`.trim();
    // If the divider is decorative, hide from assistive technology
    if (decorative) {
        return <hr className={classes} aria-hidden="true" {...rest} />;
    }
    return <hr className={classes} role="separator" aria-orientation="horizontal" tabIndex={-1} {...rest} />;
}

export default Divider;