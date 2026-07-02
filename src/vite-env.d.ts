/// <reference types="vite/client" />

import type * as React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "md-linear-progress": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        value?: number;
        indeterminate?: boolean;
      };
      "md-circular-progress": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        indeterminate?: boolean;
      };
    }
  }
}

export {};
