"""Pydantic 数据模型 - 与前端 TypeScript 接口一一对应"""

from typing import Optional, Literal, Any
from pydantic import BaseModel, Field


class ContinuousVariable(BaseModel):
    name: str
    min: float
    max: float
    step: Optional[float] = None
    unit: Optional[str] = None


class CategoricalVariable(BaseModel):
    name: str
    options: list[str]
    encoding: Optional[Literal['onehot', 'descriptor']] = 'onehot'
    descriptorFile: Optional[str] = None


class DiscreteVariable(BaseModel):
    name: str
    min: int
    max: int
    step: int


class Constraint(BaseModel):
    expression: str
    description: str


class Objective(BaseModel):
    name: str
    type: Literal['maximize', 'minimize']
    weight: Optional[float] = 1.0
    target: Optional[float] = None


class BOSettings(BaseModel):
    mode: Literal['single', 'multi'] = 'single'
    objectives: list[Objective] = Field(default_factory=lambda: [Objective(name='目标1', type='maximize', weight=1)])
    kernel: Literal['matern52', 'rbf', 'auto'] = 'matern52'
    surrogate: Literal['', 'rf', 'tpe'] = ''
    acquisition: Literal['EI', 'PI', 'UCB', 'qEI', 'qUCB', 'thompson'] = 'EI'
    explorationRate: float = 0.5
    batchSize: int = 1
    batchStrategy: Literal['qEI', 'constantLiar', 'localPenalty', 'thompson'] = 'qEI'
    maxIterations: int = 100
    stopCondition: Literal['iterations', 'improvement', 'threshold'] = 'iterations'
    improvementThreshold: float = 0.01


class Experiment(BaseModel):
    id: int
    batch: int
    variables: dict[str, float | str]
    objectives: dict[str, Optional[float]]
    source: Literal['LHS', 'BO', 'Manual'] = 'LHS'
    status: Literal['pending', 'completed', 'running'] = 'pending'
    timestamp: str


class SHAPValuesResponse(BaseModel):
    featureNames: list[str]
    shapValues: list[float]
    featureValues: list[float]
    baseValue: float
    outputValue: float


# ---- 请求体模型 ----

class LHSGenerateRequest(BaseModel):
    continuousVars: list[ContinuousVariable] = Field(default_factory=list)
    categoricalVars: list[CategoricalVariable] = Field(default_factory=list)
    discreteVars: list[DiscreteVariable] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    nSamples: int = 20


class BOSuggestRequest(BaseModel):
    experiments: list[Experiment]
    settings: BOSettings


class BOSurfaceRequest(BaseModel):
    experiments: list[Experiment]
    settings: BOSettings


class ExperimentUpdateRequest(BaseModel):
    objectives: dict[str, float]


# ---- 响应体模型 ----

class BOSuggestResponse(BaseModel):
    variables: dict[str, float | str]
    expectedImprovement: float
    uncertainty: float


class SurfaceDataResponse(BaseModel):
    x: list[float]
    y: list[float]
    z: list[list[float]]
    uncertainty: Optional[list[list[float]]] = None


class CandidatePoolItem(BaseModel):
    variables: dict[str, float | str]
    expectedImprovement: float
    uncertainty: float
    riskScore: float


class CandidatePoolResponse(BaseModel):
    candidates: list[CandidatePoolItem]
    topAcquisition: float


class PartialDependenceResponse(BaseModel):
    featureName: str
    xValues: list[float]
    yValues: list[float]
    lowerBound: Optional[list[float]] = None
    upperBound: Optional[list[float]] = None


class BOBatchSuggestRequest(BaseModel):
    experiments: list[Experiment]
    settings: BOSettings
    nCandidates: int = 5


class PartialDependenceRequest(BaseModel):
    experiments: list[Experiment]
    featureName: str
    colorFeature: Optional[str] = None


# ---- Pair Plot 模型 ----

class PairPlotRequest(BaseModel):
    experiments: list[Experiment]


class VariableStat(BaseModel):
    name: str
    min: float
    max: float
    mean: float
    std: float
    cv: float


class PairPlotResponse(BaseModel):
    correlationMatrix: dict[str, dict[str, float]]
    variableStats: list[VariableStat]
    featureNames: list[str]


# ---- 用户认证模型 ----

class User(BaseModel):
    id: int
    username: str
    hashed_password: str
    created_at: str = ''


class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)


class UserLoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    username: str
    user_id: int


class UserInfoResponse(BaseModel):
    id: int
    username: str
    created_at: str


# ---- 数据上传模型 ----

class UploadColumn(BaseModel):
    name: str
    type: Literal['continuous', 'categorical', 'discrete']
    count: int
    unique: int
    min: Optional[float] = None
    max: Optional[float] = None
    options: Optional[list[str]] = None
    missing: int = 0


# ---- 审计日志模型 ----

class AuditLogEntry(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: str
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class AuditLogResponse(BaseModel):
    logs: list[AuditLogEntry]
    total: int


class UploadPreviewResponse(BaseModel):
    columns: list[UploadColumn]
    rows: list[dict[str, Any]]
    totalRows: int
    totalCols: int
    sheetName: str = 'Sheet1'


class ProjectState(BaseModel):
    experiments: list[Experiment] = Field(default_factory=list)
    historyStack: list[Any] = Field(default_factory=list)  # HistoryEntry[] — 完整状态快照
    separationIndex: int = -1
    boSettings: dict[str, Any] = Field(default_factory=dict)
    lhsConfig: dict[str, Any] = Field(default_factory=dict)


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ''


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    state: ProjectState | None = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str
    created_at: str
    updated_at: str
    state: ProjectState
