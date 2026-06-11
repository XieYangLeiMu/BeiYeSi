declare module 'plotly.js-dist-min' {
  import Plotly from 'plotly.js';
  export = Plotly;
}

declare module 'react-plotly.js' {
  import * as React from 'react';
  interface PlotParams {
    data: any[];
    layout?: any;
    config?: any;
    style?: React.CSSProperties;
    className?: string;
    useResizeHandler?: boolean;
    onInitialized?: (figure: any) => void;
    onUpdate?: (figure: any) => void;
    onPurge?: (figure: any) => void;
    onError?: (err: Error) => void;
    onClick?: (event: any) => void;
    [key: string]: any;
  }
  const Plot: React.FC<PlotParams>;
  export default Plot;
}
