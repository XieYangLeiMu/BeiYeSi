// 共享类型定义

export interface ContinuousVariable {
  name: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export interface CategoricalVariable {
  name: string;
  options: string[];
  encoding?: 'onehot' | 'descriptor';
  descriptorFile?: string;
}

export interface DiscreteVariable {
  name: string;
  min: number;
  max: number;
  step: number;
}

export interface Constraint {
  expression: string;
  description: string;
}

export interface Experiment {
  id: number;
  batch: number;
  variables: Record<string, any>;
  objectives: Record<string, number | null>;
  source: 'LHS' | 'BO' | 'Manual';
  status: 'pending' | 'completed' | 'running';
  timestamp: string;
}

export interface Objective {
  name: string;
  type: 'maximize' | 'minimize';
  weight?: number;
  target?: number;
}

export interface BOSettings {
  mode: 'single' | 'multi';
  objectives: Objective[];
  kernel: 'matern52' | 'rbf' | 'auto';
  surrogate: '' | 'rf' | 'tpe';
  acquisition: 'EI' | 'PI' | 'UCB';
  explorationRate: number;
  batchSize: number;
  batchStrategy: 'qEI' | 'constantLiar' | 'localPenalty' | 'thompson';
  maxIterations: number;
  stopCondition: 'iterations' | 'improvement' | 'threshold';
  improvementThreshold: number;
}

export interface SHAPValues {
  featureNames: string[];
  shapValues: number[];
  featureValues: number[];
  baseValue: number;
  outputValue: number;
}

export interface SurfaceData {
  x: number[];
  y: number[];
  z: number[][];
  uncertainty?: number[][];
}

export interface CandidatePoint {
  variables: Record<string, number | string>;
  expectedImprovement: number;
  uncertainty: number;
  riskScore: number;
}

export interface CandidatePoolData {
  candidates: CandidatePoint[];
  topAcquisition: number;
}

export interface PartialDependenceData {
  featureName: string;
  xValues: number[];
  yValues: number[];
  lowerBound?: number[];
  upperBound?: number[];
}

// ---- 数据上传类型 ----

export interface UploadColumn {
  name: string;
  type: 'continuous' | 'categorical' | 'discrete';
  count: number;
  unique: number;
  min?: number | null;
  max?: number | null;
  options?: string[] | null;
  missing: number;
}

export interface UploadPreview {
  columns: UploadColumn[];
  rows: Record<string, any>[];
  totalRows: number;
  totalCols: number;
  sheetName: string;
}

// ---- 审计日志类型 ----

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  detail: Record<string, any>;
  created_at: string;
}

// ---- 项目管理类型 ----

export interface HistoryEntry {
  experiments: Experiment[];
  boSettings: BOSettings;
  separationIndex: number;
}

export interface ProjectState {
  experiments: Experiment[];
  historyStack: HistoryEntry[];
  separationIndex: number;
  boSettings: BOSettings;
  lhsConfig: Record<string, any>;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  state: ProjectState;
}

// ---- Pair Plot 类型 ----

export interface VariableStat {
  name: string;
  min: number;
  max: number;
  mean: number;
  std: number;
  cv: number;
}

export interface PairPlotData {
  correlationMatrix: Record<string, Record<string, number>>;
  variableStats: VariableStat[];
  featureNames: string[];
}
