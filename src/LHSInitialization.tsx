// LHSInitialization.tsx - 深色科技风 LHS 初始化页面
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Row, Col, Button, Input, Select, Checkbox, Tag, InputNumber,
  message, Modal,
} from 'antd';
import {
  PlusOutlined, UploadOutlined, CheckCircleFilled, EllipsisOutlined,
} from '@ant-design/icons';
import type { Experiment } from './types';
import type { PairPlotData } from './types';
import Plot from 'react-plotly.js';
import DataUploadModal from './DataUploadModal';
import * as XLSX from 'xlsx';

interface Props {
  experiments: Experiment[];
  separationIndex: number;
  onLHSGenerated: (exps: Experiment[]) => void;
  onImportExperiments: (exps: Experiment[]) => void;
  onDeleteExperiment: (expId: number) => void;
  callAPI: (endpoint: string, method: string, data?: any, isFormData?: boolean) => Promise<any>;
  loading: boolean;
  onNavigate?: (tab: string) => void;
}

// ---- 样式工具 ----
const cardStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const cardTitleStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 1,
};

const statBoxStyle: React.CSSProperties = {
  background: '#1a1a1a',
  borderRadius: 6,
  padding: '8px 10px',
  border: '1px solid #2a2a2a',
  textAlign: 'center',
};

const statValueStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1.2,
};

const statLabelStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  marginTop: 2,
};

const sectionLabel: React.CSSProperties = {
  color: '#999',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  marginBottom: 6,
};

const BadgeType = {
  Continuous: 'Continuous' as const,
  Categorical: 'Categorical' as const,
  Discrete: 'Discrete' as const,
};
type BadgeType = (typeof BadgeType)[keyof typeof BadgeType];

const VariableCard: React.FC<{
  label: string;
  badge: string;
  badgeColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
}> = ({ label, badge, badgeColor, children, defaultOpen = true, onDelete, onRename }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(label);
    setEditing(true);
  };

  const handleConfirmRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== label && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  return (
    <div style={{
      ...cardStyle,
      borderColor: open ? badgeColor : '#2a2a2a',
      borderWidth: open ? 2 : 1,
      padding: 12,
      marginBottom: 8,
    }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: open ? 12 : 0 }}
        onClick={() => setOpen(!open)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: badgeColor, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {badge}
          </span>
          {editing ? (
            <Input
              size="small"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={handleConfirmRename}
              onBlur={handleConfirmRename}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{ width: 130, background: '#1a1a1a', borderColor: '#4a9bd9', color: '#e0e0e0', fontSize: 13 }}
            />
          ) : (
            <span
              style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 500, cursor: onRename ? 'text' : 'default' }}
              onClick={onRename ? handleStartEdit : undefined}
              title={onRename ? '点击修改变量名' : undefined}
            >
              {label}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onDelete && (
            <span
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              style={{ color: '#e05555', fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
              title="删除此变量"
            >
              ✕
            </span>
          )}
          <span style={{ color: '#666', fontSize: 14 }}>{open ? '−' : '+'}</span>
        </div>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
};

interface ConstraintItem {
  id: string;
  leftTokens: string[];
  cmp: '<=' | '>=' | '<' | '>' | '=';
  rightVal: number;
}

const LHSInitialization: React.FC<Props> = ({ experiments, separationIndex, onLHSGenerated, onImportExperiments, onDeleteExperiment, callAPI, loading, onNavigate }) => {
  const [numSamples, setNumSamples] = useState(10);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  // 约束条件
  const [constraints, setConstraints] = useState<ConstraintItem[]>([]);
  const [buildTokens, setBuildTokens] = useState<string[]>([]);
  const [currentCmp, setCurrentCmp] = useState<ConstraintItem['cmp']>('<=');
  const [currentRight, setCurrentRight] = useState<number>(100);
  const [constraintsEnabled, setConstraintsEnabled] = useState(true);

  // Pair Plot 变量筛选：控制哪些数值变量参与矩阵绘制
  const [selectedPairVars, setSelectedPairVars] = useState<string[]>([]);

  // Pair Plot 正方形尺寸：ResizeObserver 精确测量可用空间
  const pairplotContainerRef = useRef<HTMLDivElement>(null);
  const [pairplotSquareSize, setPairplotSquareSize] = useState<number>(400);

  useEffect(() => {
    const el = pairplotContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setPairplotSquareSize(Math.floor(Math.min(width, height)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // 挂载一次，ResizeObserver 自动响应后续尺寸变化

  // 连续变量配置（多组分配方设计）
  const [continuousVars, setContinuousVars] = useState([
    { name: '反应物A', min: 0.1, max: 10.0, step: 0.1, unit: '' },
    { name: '反应物B', min: 0.1, max: 10.0, step: 0.1, unit: '' },
    { name: '温度', min: 80, max: 200, step: 1, unit: '' },
  ]);
  // 分类变量配置
  const [categoricalVars, setCategoricalVars] = useState([
    { name: '溶剂类型', options: ['DMF', 'Ethanol', 'Water', 'ACN'], encoding: 'onehot' as const },
  ]);
  // 离散变量配置
  const [discreteVars, setDiscreteVars] = useState([
    { name: '搅拌速度', min: 200, max: 1000, step: 50 },
  ]);
  // 添加变量对话框状态
  const [showAddVar, setShowAddVar] = useState(false);
  const [newVarType, setNewVarType] = useState<'continuous' | 'categorical' | 'discrete'>('continuous');
  const [newVarName, setNewVarName] = useState('');

  // 重命名变量时同步更新约束中的引用
  const syncConstraintRename = useCallback((oldName: string, newName: string) => {
    setConstraints((prev) =>
      prev.map((c) => ({
        ...c,
        leftTokens: c.leftTokens.map((t) => (t === oldName ? newName : t)),
      }))
    );
    setBuildTokens((prev) => prev.map((t) => (t === oldName ? newName : t)));
  }, []);

  const handleContinuousRename = (ci: number) => (newName: string) => {
    const oldName = continuousVars[ci].name;
    if (newName === oldName) return;
    if (continuousVars.some((v, i) => i !== ci && v.name === newName)) {
      message.warning('变量名已存在');
      return;
    }
    const next = [...continuousVars];
    next[ci] = { ...next[ci], name: newName };
    setContinuousVars(next);
    syncConstraintRename(oldName, newName);
  };

  const handleCategoricalRename = (ci: number) => (newName: string) => {
    const oldName = categoricalVars[ci].name;
    if (newName === oldName) return;
    if (categoricalVars.some((v, i) => i !== ci && v.name === newName)) {
      message.warning('变量名已存在');
      return;
    }
    const next = [...categoricalVars];
    next[ci] = { ...next[ci], name: newName };
    setCategoricalVars(next);
    syncConstraintRename(oldName, newName);
  };

  const handleDiscreteRename = (di: number) => (newName: string) => {
    const oldName = discreteVars[di].name;
    if (newName === oldName) return;
    if (discreteVars.some((v, i) => i !== di && v.name === newName)) {
      message.warning('变量名已存在');
      return;
    }
    const next = [...discreteVars];
    next[di] = { ...next[di], name: newName };
    setDiscreteVars(next);
    syncConstraintRename(oldName, newName);
  };

  // 全部变量名列表（用于约束构建器）
  const allVarNames = React.useMemo(() => {
    const names: string[] = [];
    continuousVars.forEach((v) => names.push(v.name));
    discreteVars.forEach((v) => names.push(v.name));
    categoricalVars.forEach((v) => names.push(v.name));
    return names;
  }, [continuousVars, discreteVars, categoricalVars]);

  // 提取变量名列表（用于表头）
  const varNames = React.useMemo(() => {
    const names: string[] = [];
    continuousVars.forEach((v) => names.push(v.name));
    discreteVars.forEach((v) => names.push(v.name));
    categoricalVars.forEach((v) => names.push(v.name));
    return names;
  }, [continuousVars, discreteVars, categoricalVars]);

  // 从 experiments 中提取所有数值变量名（取联合，防止导入数据不同实验键不同）
  const numericVarNames = React.useMemo(() => {
    if (experiments.length === 0) return [];
    const keySet = new Set<string>();
    experiments.forEach((exp) => {
      Object.keys(exp.variables).forEach((k) => {
        if (typeof exp.variables[k] === 'number') keySet.add(k);
      });
    });
    return Array.from(keySet);
  }, [experiments]);

  // Pair Plot 实际展示的变量：用户筛选的 或 全部数值变量
  const displayPairVars = React.useMemo(() => {
    if (selectedPairVars.length > 0) {
      // 保持 numericVarNames 中的原始顺序
      return numericVarNames.filter((n) => selectedPairVars.includes(n));
    }
    return numericVarNames;
  }, [numericVarNames, selectedPairVars]);

  // 生成 LHS 设计
  const handleGenerate = useCallback(async () => {
    // 构造请求体
    const requestData = {
      continuousVars: continuousVars.map((v) => ({
        name: v.name,
        min: v.min,
        max: v.max,
        step: v.step,
        unit: v.unit,
      })),
      categoricalVars: categoricalVars.map((v) => ({
        name: v.name,
        options: v.options,
        encoding: v.encoding,
      })),
      discreteVars: discreteVars.map((v) => ({
        name: v.name,
        min: v.min,
        max: v.max,
        step: v.step,
      })),
      constraints: constraintsEnabled
        ? constraints.map((c) => ({
            expression: c.leftTokens.join(' ') + ' ' + c.cmp + ' ' + c.rightVal,
            description: c.leftTokens.join(' ') + ' ' + c.cmp + ' ' + c.rightVal,
          }))
        : [],
      nSamples: numSamples,
    };

    const result = await callAPI('lhs/generate', 'POST', requestData);
    if (result && result.data) {
      onLHSGenerated(result.data);
      message.success(`已生成 ${numSamples} 个 LHS 样本`);
    } else {
      message.error('LHS 生成失败，请检查后端服务是否运行');
    }
  }, [numSamples, continuousVars, categoricalVars, discreteVars, constraints, constraintsEnabled, onLHSGenerated, callAPI]);

  // 下载 Excel 模板
  const downloadTemplate = useCallback(() => {
    const headers = ['批次', ...varNames, '目标值1', '目标值2'];
    const sampleRow: (string | number)[] = [
      1,
      ...varNames.map((name) => {
        const cv = continuousVars.find((v) => v.name === name);
        if (cv) return cv.min;
        const catv = categoricalVars.find((v) => v.name === name);
        if (catv) return catv.options[0] || '';
        const dv = discreteVars.find((v) => v.name === name);
        if (dv) return dv.min;
        return '';
      }),
      '',
      '',
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    // 列宽
    ws['!cols'] = headers.map(() => ({ wch: 16 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '实验数据');
    XLSX.writeFile(wb, '实验数据模板.xlsx');
  }, [varNames, continuousVars, categoricalVars, discreteVars]);

  // 表格列（动态）
  const columns = varNames.length > 0
    ? ['标记', '批次', ...varNames, '状态', '操作']
    : ['标记', '批次', '变量 1', '变量 2', '状态', '操作'];

  // 真实表格数据
  const tableData = experiments.length > 0
    ? experiments.map((exp) => ({
      batch: exp.batch,
      varValues: varNames.map((name) => exp.variables[name] !== undefined ? String(exp.variables[name]) : '-'),
      status: exp.status === 'completed' ? '已生成' : exp.status === 'running' ? '运行中' : '未排序',
    }))
    : [];

  // 热力图数据（memo 化防止每帧重建，避免 useMemo 依赖失效导致下游重算）
  const heatmapX = numericVarNames;
  const heatmapY = React.useMemo(() => experiments.map((e) => `#${e.batch}`), [experiments]);
  const heatmapZ = React.useMemo(() => {
    if (experiments.length === 0 || numericVarNames.length === 0) return [] as number[][];
    return experiments.map((exp) =>
      numericVarNames.map((name) => {
        const val = exp.variables[name];
        return typeof val === 'number' ? val : 0;
      })
    );
  }, [experiments, numericVarNames]);

  // ── 3D 曲面数据：直接用原始网格（不用插值，避免数据变形导致 Plotly 渲染失败）──
  const surfaceTraceData = React.useMemo(() => {
    const rows = heatmapZ.length;
    const cols = rows > 0 ? heatmapZ[0].length : 0;
    if (rows < 2 || cols < 2) return null;

    // 纯数值索引：x=[0,1,...,cols-1], y=[0,1,...,rows-1]
    const xi: number[] = [];
    for (let j = 0; j < cols; j++) xi.push(j);
    const yi: number[] = [];
    for (let i = 0; i < rows; i++) yi.push(i);

    return { z: heatmapZ, xi, yi, rows, cols };
  }, [heatmapZ]);

  // 3D surface 是否应该启用（数据 ≤ 500 基础网格点用 surface，超过用 heatmapgl）
  const useSurface3D = surfaceTraceData !== null && surfaceTraceData.rows * surfaceTraceData.cols <= 500;

  // 计算设计摘要数据
  const totalExps = experiments.length;
  const completedExps = experiments.filter((e) => e.status === 'completed').length;
  const pendingExps = experiments.filter((e) => e.status === 'pending').length;
  const dimensions = varNames.length;

  // ---- 经典 Pair Plot（散点图矩阵 + 对角核密度） ----
  const [pairPlotData, setPairPlotData] = useState<PairPlotData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchPairPlot = async () => {
      if (experiments.length < 2 || numericVarNames.length < 2) {
        setPairPlotData(null);
        return;
      }
      try {
        const result = await callAPI('pairplot/analyze', 'POST', { experiments });
        if (!cancelled && result?.data) {
          setPairPlotData(result.data);
        }
      } catch {
        // 静默失败
      }
    };
    fetchPairPlot();
    return () => { cancelled = true; };
  }, [experiments, numericVarNames.length, callAPI]);

  // 提取数值完整的实验
  const splomExps = React.useMemo(() => {
    if (numericVarNames.length === 0) return [];
    return experiments.filter((exp) =>
      numericVarNames.every((name) => typeof exp.variables[name] === 'number')
    );
  }, [experiments, numericVarNames]);

  // 按来源分组（BO / LHS / Manual）
  const pairGroups = React.useMemo(() => {
    const map: Record<string, Experiment[]> = {};
    splomExps.forEach((exp) => {
      const key = exp.source || 'Unknown';
      if (!map[key]) map[key] = [];
      map[key].push(exp);
    });
    return map;
  }, [splomExps]);

  const pairGroupKeys = Object.keys(pairGroups);
  const GROUP_COLORS: Record<string, string> = {
    'BO': '#e74c3c',
    'LHS': '#4a9bd9',
    'Manual': '#52c41a',
  };
  const FALLBACK_COLORS = ['#e74c3c', '#4a9bd9', '#52c41a', '#f39c12', '#9b59b6', '#1abc9c'];

  // 高斯核密度估计
  const gaussianKDE = (data: number[], nPts = 60) => {
    const n = data.length;
    if (n < 3) return { x: [] as number[], y: [] as number[] };
    const sorted = [...data].sort((a, b) => a - b);
    const meanVal = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - meanVal) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const q75 = sorted[Math.floor(n * 0.75)];
    const q25 = sorted[Math.floor(n * 0.25)];
    const iqr = q75 - q25;
    const h = 0.9 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2);
    if (h <= 0 || isNaN(h)) return { x: [] as number[], y: [] as number[] };
    const xMin = sorted[0] - 2.5 * h;
    const xMax = sorted[n - 1] + 2.5 * h;
    const step = (xMax - xMin) / (nPts - 1);
    const coeff = 1 / (n * h * Math.sqrt(2 * Math.PI));
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < nPts; i++) {
      const xi = xMin + i * step;
      let sum = 0;
      for (let j = 0; j < n; j++) {
        const z = (xi - sorted[j]) / h;
        sum += Math.exp(-0.5 * z * z);
      }
      x.push(xi);
      y.push(coeff * sum);
    }
    return { x, y };
  };

  // 构建 N×N 经典 pairplot traces（对角 KDE + 非对角散点）
  const pairplotTraces = React.useMemo(() => {
    const N = displayPairVars.length;
    if (N < 2 || splomExps.length === 0) return [] as any[];
    const traces: any[] = [];

    // 先创建各分组的图例条目（不可见标记）
    pairGroupKeys.forEach((grp, gi) => {
      const color = GROUP_COLORS[grp] ?? FALLBACK_COLORS[gi % FALLBACK_COLORS.length];
      traces.push({
        x: [null], y: [null],
        type: 'scatter',
        mode: 'markers',
        marker: { color, size: 8, symbol: 'circle' },
        name: grp,
        showlegend: true,
        legendgroup: grp,
        visible: true,
      });
    });

    // 根据变量数动态调整散点大小，变量越多点越小
    const markerSize = N <= 3 ? 6 : N <= 5 ? 5 : 4;
    const markerOpacity = N <= 3 ? 0.75 : N <= 5 ? 0.65 : 0.55;

    for (let r = 0; r < N; r++) {
      const ykey = r === 0 ? 'y' : `y${r + 1}`;
      const yVar = displayPairVars[r];
      for (let c = 0; c < N; c++) {
        const xkey = c === 0 ? 'x' : `x${c + 1}`;
        const xVar = displayPairVars[c];

        if (r === c) {
          // ── 对角线：核密度曲线 + 填充 ──
          pairGroupKeys.forEach((grp, gi) => {
            const vals = pairGroups[grp]
              .map((e) => e.variables[yVar])
              .filter((v) => typeof v === 'number') as number[];
            if (vals.length < 3) return;
            const kde = gaussianKDE(vals);
            if (kde.x.length === 0) return;
            const color = GROUP_COLORS[grp] ?? FALLBACK_COLORS[gi % FALLBACK_COLORS.length];
            traces.push({
              x: kde.x,
              y: kde.y,
              type: 'scatter',
              mode: 'lines',
              fill: 'tozeroy',
              fillcolor: color + '44',
              line: { color, width: 2, shape: 'spline', smoothing: 1.2 },
              name: grp,
              showlegend: false,
              legendgroup: grp,
              xaxis: xkey,
              yaxis: ykey,
              hoverinfo: 'skip',
            });
          });
        } else {
          // ── 非对角线：分组散点 ──
          pairGroupKeys.forEach((grp, gi) => {
            const color = GROUP_COLORS[grp] ?? FALLBACK_COLORS[gi % FALLBACK_COLORS.length];
            const xVals = pairGroups[grp].map((e) => e.variables[xVar] as number);
            const yVals = pairGroups[grp].map((e) => e.variables[yVar] as number);
            traces.push({
              x: xVals,
              y: yVals,
              type: 'scatter',
              mode: 'markers',
              marker: {
                color,
                size: markerSize,
                opacity: markerOpacity,
                line: { color: 'rgba(255,255,255,0.25)', width: 0.8 },
              },
              name: grp,
              showlegend: false,
              legendgroup: grp,
              xaxis: xkey,
              yaxis: ykey,
              hoverinfo: 'text',
              hovertemplate: `<b>${grp}</b> 批次%{customdata}<br>${xVar}: %{x}<br>${yVar}: %{y}<extra></extra>`,
              customdata: pairGroups[grp].map((e) => e.batch),
            });
          });
        }
      }
    }
    return traces;
  }, [displayPairVars, splomExps, pairGroups, pairGroupKeys]);

  // 构建 N×N 子图网格布局（高度随变量数动态缩放）
  const pairplotLayout = React.useMemo(() => {
    const N = displayPairVars.length;
    if (N < 2) return {};
    const pad = 0.018;   // 格子间距（减小使格子更紧凑）
    const layout: any = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: '#111',
      font: { color: '#ccc', size: 9 },
      showlegend: true,
      legend: {
        x: 1.02, y: 1, xanchor: 'left', yanchor: 'top',
        bgcolor: 'rgba(18,18,18,0.95)',
        bordercolor: '#333',
        borderwidth: 1,
        font: { size: 11, color: '#e0e0e0' },
        itemsizing: 'constant',
        itemclick: 'toggle',
        itemdoubleclick: 'toggleothers',
        tracegroupgap: 4,
      },
      margin: { l: 60, r: 120, t: 20, b: 60 },
      dragmode: 'pan',
      hovermode: 'closest',
      shapes: [] as any[],
    };

    // ── 为每个格子加细线边框，对角格子加蓝色高亮背景 ──
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x0 = j / N + pad * 0.3;
        const x1 = (j + 1) / N - pad * 0.3;
        const y0 = 1 - (i + 1) / N + pad * 0.3;
        const y1 = 1 - i / N - pad * 0.3;
        const isDiag = i === j;
        layout.shapes.push({
          type: 'rect',
          xref: 'paper', yref: 'paper',
          x0, y0, x1, y1,
          fillcolor: isDiag ? 'rgba(74,155,217,0.06)' : 'rgba(0,0,0,0)',
          line: { width: isDiag ? 0.8 : 0.5, color: isDiag ? '#2a4a6a' : '#222' },
          layer: 'below',
        });
      }
    }

    for (let i = 0; i < N; i++) {
      const xkey = i === 0 ? 'xaxis' : `xaxis${i + 1}`;
      const ykey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
      layout[xkey] = {
        domain: [i / N + pad, (i + 1) / N - pad],
        title: { text: displayPairVars[i], font: { size: 10, color: '#bbb' }, standoff: 4 },
        showgrid: true,
        gridcolor: '#1e1e1e',
        gridwidth: 0.5,
        zeroline: false,
        tickfont: { size: 8, color: '#666' },
        linecolor: '#2a2a2a',
        linewidth: 0.5,
        showline: true,
        automargin: true,
        anchor: 'free',
        showspikes: true,
        spikecolor: '#444',
        spikethickness: 0.5,
      };
      layout[ykey] = {
        domain: [1 - (i + 1) / N + pad, 1 - i / N - pad],
        title: { text: displayPairVars[i], font: { size: 10, color: '#bbb' }, standoff: 4 },
        showgrid: true,
        gridcolor: '#1e1e1e',
        gridwidth: 0.5,
        zeroline: false,
        tickfont: { size: 8, color: '#666' },
        linecolor: '#2a2a2a',
        linewidth: 0.5,
        showline: true,
        automargin: true,
        anchor: 'free',
        showspikes: true,
        spikecolor: '#444',
        spikethickness: 0.5,
      };
    }

    return layout;
  }, [displayPairVars]);

  const pairplotReady = pairplotTraces.length > 0 && displayPairVars.length >= 2;

  return (
    <div style={{ padding: 16, height: '100%', minHeight: 'calc(100vh - 80px)' }}>
      <Row gutter={12} style={{ height: '100%' }}>
        {/* ===== 左侧列 (60%) ===== */}
        <Col span={14} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ---- 左上：VARIABLE CONFIGURATOR ---- */}
          <div style={{ ...cardStyle, flex: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={cardTitleStyle}>变量配置器</span>
              <EllipsisOutlined style={{ color: '#888', fontSize: 14, cursor: 'pointer' }} />
            </div>

            {/* Add New Variable 按钮 & 导入数据按钮 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setShowAddVar(true)}
                style={{
                  background: '#4a9bd9', borderColor: '#4a9bd9',
                  borderRadius: 6, fontSize: 12,
                  height: 32,
                }}
              >
                添加新变量
              </Button>
              <Button
                icon={<UploadOutlined />}
                onClick={() => setUploadModalVisible(true)}
                style={{
                  background: '#1a1a1a', borderColor: '#333', color: '#ccc',
                  borderRadius: 6, fontSize: 12,
                  height: 32,
                }}
              >
                导入 XLSX 数据
              </Button>
              <Button
                onClick={downloadTemplate}
                style={{
                  background: '#1a1a1a', borderColor: '#333', color: '#ccc',
                  borderRadius: 6, fontSize: 12,
                  height: 32,
                }}
              >
                📄 Excel 模板
              </Button>
            </div>

            {/* Continuous 变量卡片 - 动态渲染 */}
            {continuousVars.map((cv, ci) => (
              <VariableCard key={cv.name} label={cv.name} badge="Continuous" badgeColor="#4a9bd9"
                onDelete={() => setContinuousVars(continuousVars.filter((_, i) => i !== ci))}
                onRename={handleContinuousRename(ci)}
              >
                <div style={{ marginBottom: 10 }}>
                  <div style={sectionLabel}>范围</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <InputNumber value={cv.min} size="small" style={{ width: 65, background: '#1a1a1a', borderColor: '#333' }}
                      onChange={(v) => {
                        const next = [...continuousVars];
                        next[ci] = { ...next[ci], min: v ?? cv.min };
                        setContinuousVars(next);
                      }}
                    />
                    <span style={{ color: '#666' }}>—</span>
                    <InputNumber value={cv.max} size="small" style={{ width: 65, background: '#1a1a1a', borderColor: '#333' }}
                      onChange={(v) => {
                        const next = [...continuousVars];
                        next[ci] = { ...next[ci], max: v ?? cv.max };
                        setContinuousVars(next);
                      }}
                    />
                    <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}></span>
                    <Select defaultValue="自定义范围" size="small" style={{ width: 130, marginLeft: 'auto' }}
                      dropdownStyle={{ background: '#1a1a1a' }}
                    />
                  </div>
                </div>

              </VariableCard>
            ))}

            {/* Categorical 变量卡片 - 动态渲染 */}
            {categoricalVars.map((catv, ci) => (
              <VariableCard key={catv.name} label={catv.name} badge="Categorical" badgeColor="#52c41a"
                onDelete={() => setCategoricalVars(categoricalVars.filter((_, i) => i !== ci))}
                onRename={handleCategoricalRename(ci)}
              >
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <div style={sectionLabel}>选项</div>
                    <Input
                      size="small"
                      placeholder="添加选项后按回车"
                      style={{ width: 160, background: '#1a1a1a', borderColor: '#333', color: '#ccc' }}
                      onPressEnter={(e) => {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val && !catv.options.includes(val)) {
                          const next = [...categoricalVars];
                          next[ci] = { ...next[ci], options: [...next[ci].options, val] };
                          setCategoricalVars(next);
                        }
                        (e.target as HTMLInputElement).value = '';
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {catv.options.map((opt, oi) => (
                      <Tag key={opt} closable onClose={() => {
                        const next = [...categoricalVars];
                        next[ci] = { ...next[ci], options: next[ci].options.filter((_, i) => i !== oi) };
                        setCategoricalVars(next);
                      }} style={{ background: '#1a1a1a', borderColor: '#333', color: '#ccc', borderRadius: 4 }}>{opt}</Tag>
                    ))}
                  </div>
                </div>
              </VariableCard>
            ))}

            {/* Discrete 变量卡片 - 动态渲染 */}
            {discreteVars.map((dv, di) => (
              <VariableCard key={dv.name} label={dv.name} badge="Discrete" badgeColor="#f39c12"
                onDelete={() => setDiscreteVars(discreteVars.filter((_, i) => i !== di))}
                onRename={handleDiscreteRename(di)}
              >
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={sectionLabel}>最小值</div>
                    <InputNumber value={dv.min} size="small" style={{ width: 80, background: '#1a1a1a', borderColor: '#333' }}
                      onChange={(v) => {
                        const next = [...discreteVars];
                        next[di] = { ...next[di], min: v ?? dv.min };
                        setDiscreteVars(next);
                      }}
                    />
                  </div>
                  <div>
                    <div style={sectionLabel}>最大值</div>
                    <InputNumber value={dv.max} size="small" style={{ width: 80, background: '#1a1a1a', borderColor: '#333' }}
                      onChange={(v) => {
                        const next = [...discreteVars];
                        next[di] = { ...next[di], max: v ?? dv.max };
                        setDiscreteVars(next);
                      }}
                    />
                  </div>
                  <div>
                    <div style={sectionLabel}>整数步长</div>
                    <InputNumber value={dv.step} size="small" style={{ width: 80, background: '#1a1a1a', borderColor: '#333' }}
                      onChange={(v) => {
                        const next = [...discreteVars];
                        next[di] = { ...next[di], step: (v ?? dv.step) as number };
                        setDiscreteVars(next);
                      }}
                    />
                  </div>
                </div>
              </VariableCard>
            ))}

            {/* Constraints */}
            <div style={{ marginTop: 12, ...cardStyle, borderColor: '#e8e8e8', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Checkbox
                  checked={constraintsEnabled}
                  onChange={(e) => setConstraintsEnabled(e.target.checked)}
                  style={{ color: '#e0e0e0' }}
                />
                <span style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 600 }}>约束条件</span>
                <span style={{ color: '#666', fontSize: 10, marginLeft: 'auto' }}>
                  配方设计 · 表达式构建器
                </span>
              </div>

              {constraintsEnabled && (
                <>
                  {/* 变量按钮行 */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={sectionLabel}>变量</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {allVarNames.map((name) => (
                        <Button
                          key={name}
                          size="small"
                          onClick={() => setBuildTokens([...buildTokens, name])}
                          style={{
                            fontSize: 11, height: 24, borderRadius: 4,
                            background: '#0d3b66', borderColor: '#4a9bd9', color: '#4a9bd9',
                          }}
                        >
                          {name}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* 操作符按钮行 */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={sectionLabel}>操作符</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {['+', '-', '*', '/', '(', ')'].map((op) => (
                        <Button
                          key={op}
                          size="small"
                          onClick={() => setBuildTokens([...buildTokens, op])}
                          style={{
                            fontSize: 12, height: 24, width: 32, borderRadius: 4,
                            background: '#1a1a1a', borderColor: '#333', color: '#52c41a',
                            fontWeight: 700, fontFamily: 'monospace',
                          }}
                        >
                          {op}
                        </Button>
                      ))}
                      <Button
                        size="small"
                        danger
                        onClick={() => setBuildTokens([])}
                        style={{ fontSize: 11, height: 24, borderRadius: 4, marginLeft: 8 }}
                      >
                        清空
                      </Button>
                    </div>
                  </div>

                  {/* 表达式预览与添加 */}
                  <div style={{
                    marginBottom: 8, padding: '8px 10px',
                    background: '#0d0d0d', borderRadius: 6, border: '1px solid #222',
                  }}>
                    {/* token 逐个展示，可单独删除 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, minHeight: 26 }}>
                      {buildTokens.length === 0 ? (
                        <span style={{ color: '#ccc', fontFamily: 'monospace', fontSize: 12 }}>点击变量和操作符构建表达式</span>
                      ) : (
                        buildTokens.map((tok, ti) => (
                          <span
                            key={ti}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              background: '#1a2a1a', border: '1px solid rgba(82,196,26,0.35)',
                              borderRadius: 3, padding: '1px 6px',
                              color: '#52c41a', fontFamily: 'monospace', fontSize: 12,
                            }}
                          >
                            {tok}
                            <span
                              onClick={() => setBuildTokens(buildTokens.filter((_, i) => i !== ti))}
                              style={{ cursor: 'pointer', color: '#e05555', fontSize: 11, lineHeight: 1, marginLeft: 1 }}
                              title="删除此项"
                            >×</span>
                          </span>
                        ))
                      )}
                    </div>
                    {/* 比较符 + 右值 + 添加按钮 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Select
                      value={currentCmp}
                      onChange={(v) => setCurrentCmp(v)}
                      size="small"
                      style={{ width: 72 }}
                      dropdownStyle={{ background: '#1a1a1a' }}
                      options={[
                        { value: '<=', label: '≤' },
                        { value: '>=', label: '≥' },
                        { value: '<', label: '<' },
                        { value: '>', label: '>' },
                        { value: '=', label: '=' },
                      ]}
                    />
                    <InputNumber
                      value={currentRight}
                      onChange={(v) => setCurrentRight(v ?? 0)}
                      size="small"
                      style={{ width: 80, background: '#1a1a1a', borderColor: '#333' }}
                    />
                    <Button
                      size="small"
                      type="primary"
                      disabled={buildTokens.length === 0}
                      onClick={() => {
                        setConstraints([
                          ...constraints,
                          {
                            id: Date.now().toString(),
                            leftTokens: [...buildTokens],
                            cmp: currentCmp,
                            rightVal: currentRight,
                          },
                        ]);
                        setBuildTokens([]);
                      }}
                      style={{
                        background: '#52c41a', borderColor: '#52c41a',
                        fontSize: 11, height: 26, borderRadius: 4,
                      }}
                    >
                      + 添加
                    </Button>
                    </div>{/* end 比较符行 */}
                  </div>

                  {/* 已添加的约束列表 */}
                  {constraints.length > 0 && (
                    <div>
                      <div style={sectionLabel}>已添加约束</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {constraints.map((c, ci) => (
                          <div key={c.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '5px 10px', background: 'rgba(82,196,26,0.08)',
                            borderRadius: 4, border: '1px solid rgba(82,196,26,0.2)',
                          }}>
                            <span style={{
                              color: '#52c41a', fontFamily: 'monospace', fontSize: 12, flex: 1,
                            }}>
                              {c.leftTokens.join(' ')} {c.cmp === '<=' ? '≤' : c.cmp === '>=' ? '≥' : c.cmp} {c.rightVal}
                            </span>
                            <Button
                              size="small"
                              danger
                              onClick={() => setConstraints(constraints.filter((_, i) => i !== ci))}
                              style={{
                                fontSize: 10, height: 20, width: 20, padding: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                            >
                              ✕
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Sample Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#999', fontSize: 12, fontWeight: 600 }}>样本数量</span>
                <InputNumber
                  value={numSamples}
                  onChange={(v) => setNumSamples(v || 10)}
                  min={1} max={100}
                  size="small"
                  style={{ width: 70, background: '#1a1a1a', borderColor: '#333', color: '#fff' }}
                />
              </div>
              <Button
                type="primary"
                onClick={handleGenerate}
                loading={loading}
                style={{
                  background: '#4a9bd9', borderColor: '#4a9bd9',
                  borderRadius: 6, fontSize: 12, height: 32, fontWeight: 600,
                }}
              >
                生成设计
              </Button>
            </div>
          </div>

          {/* ---- 左下：Pair Plot 散点图矩阵 ---- */}
          <div style={{ ...cardStyle, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: displayPairVars.length * 120, maxHeight: '75vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <span style={cardTitleStyle}>Pair Plot 散点图矩阵</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="筛选变量"
                  value={selectedPairVars.length > 0 ? selectedPairVars : numericVarNames}
                  onChange={(vals) => {
                    // 如果全选 → 清空（等于不限）；否则记录选择
                    if (vals.length === numericVarNames.length) {
                      setSelectedPairVars([]);
                    } else {
                      setSelectedPairVars(vals);
                    }
                  }}
                  maxTagCount={1}
                  style={{ minWidth: 120, maxWidth: 200 }}
                  dropdownStyle={{ background: '#1a1a1a' }}
                  options={numericVarNames.map((n) => ({ value: n, label: n }))}
                  tokenSeparators={[',']}
                />
                <EllipsisOutlined style={{ color: '#888', fontSize: 14, cursor: 'pointer' }} />
              </div>
            </div>
            <div
              ref={pairplotContainerRef}
              style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              <div style={{
                width: pairplotSquareSize,
                height: pairplotSquareSize,
                maxWidth: '100%',
                maxHeight: '100%',
              }}>
                {!pairplotReady ? (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', color: '#ccc', fontSize: 13, gap: 8,
                  }}>
                    <span>需要至少 2 个数值变量才能生成散点图矩阵</span>
                    {experiments.length < 2 && <span style={{ fontSize: 11, color: '#888' }}>当前实验数: {experiments.length}</span>}
                  </div>
                ) : (
                  <Plot
                    data={pairplotTraces}
                    layout={pairplotLayout}
                    config={{
                      displayModeBar: true, responsive: true, displaylogo: false,
                      modeBarButtonsToRemove: ['lasso2d', 'sendDataToCloud'],
                      toImageButtonOptions: { format: 'png', filename: 'pairplot' },
                    }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                )}
              </div>
            </div>
          </div>
        </Col>
        {/* ===== 右侧列 (40%) ===== */}
        <Col span={10} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ---- 右上：实验数据 ---- */}
          <div style={{ ...cardStyle, flex: 'none', maxHeight: 340, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={cardTitleStyle}>实验数据</span>
              <EllipsisOutlined style={{ color: '#888', fontSize: 14, cursor: 'pointer' }} />
            </div>
            {tableData.length === 0 ? (
              <div style={{ color: '#666', fontSize: 12, padding: 20, textAlign: 'center' }}>暂无实验数据</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: '#ccc' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                    {columns.map((col, ci) => (
                      <th key={ci} style={{ padding: '4px 6px', textAlign: 'left', color: '#888', fontWeight: 500, whiteSpace: 'nowrap' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, ri) => {
                    const exp = experiments[ri];
                    const isNew = separationIndex >= 0 && ri > separationIndex;
                    return (
                      <tr key={ri} style={{
                        borderBottom: '1px solid #2a2a2a',
                        background: isNew ? 'rgba(82,196,26,0.08)' : 'transparent',
                      }}>
                        <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                          {exp && (exp.source === 'LHS' || exp.source === 'BO') ? (
                            <span style={{ color: '#e74c3c', fontSize: 14 }}>🚩</span>
                          ) : (
                            <span style={{ color: '#888', fontSize: 14 }}>·</span>
                          )}
                        </td>
                        <td style={{ padding: '3px 6px', color: '#4a9bd9', fontWeight: 500 }}>#{row.batch}</td>
                        {row.varValues.map((val, vi) => (
                          <td key={vi} style={{ padding: '3px 6px', color: '#ccc' }}>{val}</td>
                        ))}
                        <td style={{ padding: '3px 6px' }}>
                          <Tag color={row.status === '已生成' ? 'green' : row.status === '运行中' ? 'blue' : 'default'} style={{ fontSize: 10, lineHeight: '16px' }}>
                            {row.status}
                          </Tag>
                        </td>
                        <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                          <span
                            style={{ color: '#e74c3c', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                            onClick={() => onDeleteExperiment?.(ri)}
                            title="删除此条实验"
                          >✕</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- 右中：实验设计方案摘要 ---- */}
          <div style={{ ...cardStyle, flex: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={cardTitleStyle}>实验设计方案摘要</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={statBoxStyle}>
                <div style={statValueStyle}>{totalExps}</div>
                <div style={statLabelStyle}>总实验数</div>
              </div>
              <div style={statBoxStyle}>
                <div style={statValueStyle}>{dimensions}</div>
                <div style={statLabelStyle}>变量维度</div>
              </div>
              <div style={statBoxStyle}>
                <div style={{ ...statValueStyle, color: '#52c41a' }}>{completedExps}</div>
                <div style={statLabelStyle}>已完成</div>
              </div>
              <div style={statBoxStyle}>
                <div style={{ ...statValueStyle, color: '#faad14' }}>{pendingExps}</div>
                <div style={statLabelStyle}>待处理</div>
              </div>
            </div>
          </div>

          {/* ---- 右下：采样空间热力图（数据多时 2D heatmap，数据少时 3D surface） ---- */}
          {heatmapZ.length > 1 && heatmapZ[0].length > 1 && surfaceTraceData !== null && (
            <div style={{ ...cardStyle, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 320 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={cardTitleStyle}>
                  采样空间{useSurface3D ? '3D曲面' : '热力图'}
                </span>
                {!useSurface3D && (
                  <span style={{ fontSize: 10, color: '#666' }}>
                    {surfaceTraceData.rows}×{surfaceTraceData.cols} 网格（已超出 3D 渲染上限，自动降级为热力图）
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {useSurface3D ? (
                  /* ---- 3D 曲面：数据量 ≤ 500 网格点，简单可靠 ---- */
                  <Plot
                    data={[{
                      z: surfaceTraceData.z,
                      x: surfaceTraceData.xi,
                      y: surfaceTraceData.yi,
                      type: 'surface',
                      contours: {
                        x: { show: true, color: '#333', width: 0.3, highlight: false },
                        y: { show: true, color: '#333', width: 0.3, highlight: false },
                        z: { show: true, color: '#333', width: 0.3, highlight: false },
                      },
                      colorscale: [
                        [0.0, '#2a0052'], [0.1, '#3b0f6b'], [0.2, '#5c1d8f'],
                        [0.3, '#2c5aa0'], [0.4, '#1a8a8a'], [0.5, '#1fa363'],
                        [0.6, '#5dc03e'], [0.7, '#a8d838'], [0.8, '#f4e83d'],
                        [0.9, '#f4a73d'], [1.0, '#e8452d'],
                      ],
                      showscale: true,
                      colorbar: {
                        thickness: 10,
                        tickfont: { color: '#888', size: 8 },
                        title: { text: '值', font: { color: '#888', size: 9 } },
                      },
                      hovertemplate: '变量: %{x}<br>批次: %{y}<br>值: %{z}<extra></extra>',
                    }]}
                    layout={{
                      paper_bgcolor: 'rgba(0,0,0,0)',
                      font: { color: '#ccc', size: 9 },
                      margin: { l: 10, r: 10, t: 20, b: 10 },
                      scene: {
                        bgcolor: '#141414',
                        xaxis: {
                          title: { text: '变量', font: { color: '#ccc', size: 10 } },
                          tickfont: { size: 8, color: '#888' },
                          tickangle: -30,
                          gridcolor: '#2a2a2a',
                          backgroundcolor: 'rgba(0,0,0,0)',
                          tickmode: 'array',
                          tickvals: heatmapX.map((_, idx) => idx),
                          ticktext: heatmapX,
                        },
                        yaxis: {
                          title: { text: '批次', font: { color: '#ccc', size: 10 } },
                          tickfont: { size: 8, color: '#888' },
                          gridcolor: '#2a2a2a',
                          backgroundcolor: 'rgba(0,0,0,0)',
                          autorange: 'reversed',
                          tickmode: 'array',
                          tickvals: heatmapY.map((_, idx) => idx),
                          ticktext: heatmapY,
                        },
                        zaxis: {
                          title: { text: '值', font: { color: '#ccc', size: 10 } },
                          tickfont: { size: 8, color: '#888' },
                          gridcolor: '#2a2a2a',
                          backgroundcolor: 'rgba(0,0,0,0)',
                        },
                        camera: { eye: { x: 1.5, y: -1.8, z: 1.2 } },
                        aspectmode: 'cube',
                      },
                      dragmode: 'turntable',
                    }}
                    config={{
                      displayModeBar: true, responsive: true, displaylogo: false,
                      modeBarButtonsToRemove: ['sendDataToCloud'],
                      scrollZoom: true,
                    }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                ) : (
                  /* ---- 2D 热力图（heatmapgl=WebGL，大量数据不卡）---- */
                  <Plot
                    data={[{
                      z: heatmapZ,
                      x: heatmapX,
                      y: heatmapY,
                      type: 'heatmapgl',
                      colorscale: [
                        [0.0, '#2a0052'], [0.1, '#3b0f6b'], [0.2, '#5c1d8f'],
                        [0.3, '#2c5aa0'], [0.4, '#1a8a8a'], [0.5, '#1fa363'],
                        [0.6, '#5dc03e'], [0.7, '#a8d838'], [0.8, '#f4e83d'],
                        [0.9, '#f4a73d'], [1.0, '#e8452d'],
                      ],
                      showscale: true,
                      colorbar: {
                        thickness: 10,
                        tickfont: { color: '#888', size: 8 },
                        title: { text: '值', font: { color: '#888', size: 9 } },
                      },
                      hovertemplate: '变量: %{x}<br>批次: %{y}<br>值: %{z}<extra></extra>',
                    }]}
                    layout={{
                      paper_bgcolor: 'rgba(0,0,0,0)',
                      plot_bgcolor: 'rgba(0,0,0,0)',
                      font: { color: '#ccc', size: 9 },
                      margin: { l: 80, r: 10, t: 20, b: 50 },
                      xaxis: {
                        title: { text: '变量', font: { color: '#ccc', size: 10 } },
                        tickfont: { size: 8, color: '#888' },
                        tickangle: 30,
                        gridcolor: '#2a2a2a',
                      },
                      yaxis: {
                        title: { text: '批次', font: { color: '#ccc', size: 10 } },
                        tickfont: { size: 8, color: '#888' },
                        gridcolor: '#2a2a2a',
                        autorange: 'reversed',
                      },
                    }}
                    config={{ displayModeBar: false, responsive: true, displaylogo: false }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                )}
              </div>
            </div>
          )}
        </Col>
      </Row>

      {/* 数据上传模态框 */}
      <DataUploadModal
        visible={uploadModalVisible}
        onClose={() => setUploadModalVisible(false)}
        callAPI={callAPI}
        onImportSuccess={onImportExperiments}
        onNavigate={onNavigate}
      />

      {/* 添加变量对话框 */}
      <Modal
        title={<span style={{ color: '#e0e0e0' }}>添加新变量</span>}
        open={showAddVar}
        onCancel={() => setShowAddVar(false)}
        styles={{
          mask: { background: 'rgba(0,0,0,0.45)' },
          content: { background: '#141414', border: '1px solid #2a2a2a' },
          header: { background: '#141414', borderBottom: '1px solid #2a2a2a' },
          footer: { borderTop: '1px solid #2a2a2a' },
        }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setShowAddVar(false)} style={{ background: '#1a1a1a', borderColor: '#333', color: '#ccc', borderRadius: 6 }}>取消</Button>
            <Button type="primary" style={{ background: '#4a9bd9', borderColor: '#4a9bd9', borderRadius: 6 }}
              onClick={() => {
                const name = newVarName.trim();
                if (!name) { message.warning('请输入变量名称'); return; }
                if (newVarType === 'continuous') {
                  if (continuousVars.some(v => v.name === name)) { message.warning('变量名已存在'); return; }
                  setContinuousVars([...continuousVars, { name, min: 0, max: 100, step: 1, unit: '' }]);
                } else if (newVarType === 'categorical') {
                  if (categoricalVars.some(v => v.name === name)) { message.warning('变量名已存在'); return; }
                  setCategoricalVars([...categoricalVars, { name, options: ['Option1', 'Option2'], encoding: 'onehot' as const }]);
                } else {
                  if (discreteVars.some(v => v.name === name)) { message.warning('变量名已存在'); return; }
                  setDiscreteVars([...discreteVars, { name, min: 0, max: 100, step: 10 }]);
                }
                setShowAddVar(false);
                setNewVarName('');
                message.success(`已添加变量「${name}」`);
              }}
            >确认添加</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ color: '#999', fontSize: 12, marginBottom: 4 }}>变量名称</div>
            <Input
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
              placeholder="输入变量名"
              style={{ background: '#1a1a1a', borderColor: '#333', color: '#ccc' }}
            />
          </div>
          <div>
            <div style={{ color: '#999', fontSize: 12, marginBottom: 4 }}>变量类型</div>
            <Select
              value={newVarType}
              onChange={(v) => setNewVarType(v)}
              style={{ width: '100%' }}
              dropdownStyle={{ background: '#1a1a1a' }}
              options={[
                { value: 'continuous', label: '连续型 (Continuous)' },
                { value: 'categorical', label: '分类型 (Categorical)' },
                { value: 'discrete', label: '离散型 (Discrete)' },
              ]}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default LHSInitialization;
