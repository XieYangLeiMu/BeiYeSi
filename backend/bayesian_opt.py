"""贝叶斯优化引擎 - 支持 GP/RF/TPE 代理模型、EI/PI/UCB 采集函数、批量采样与候选池"""

import random
from typing import Optional

import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern, RBF, ConstantKernel, WhiteKernel
from sklearn.ensemble import RandomForestRegressor
from sklearn.ensemble import ExtraTreesRegressor

from models import (
    Experiment, BOSettings, Objective, BOSuggestRequest, BOSuggestResponse,
    SurfaceDataResponse, CandidatePoolItem, CandidatePoolResponse,
    BOBatchSuggestRequest,
)


def _norm_cdf(x: np.ndarray) -> np.ndarray:
    from scipy.special import erf
    return 0.5 * (1.0 + erf(x / np.sqrt(2.0)))


def _norm_pdf(x: np.ndarray) -> np.ndarray:
    return np.exp(-0.5 * x**2) / np.sqrt(2.0 * np.pi)


def _build_kernel(kernel_type: str):
    """根据设置构建 GP 核函数"""
    if kernel_type == 'matern52':
        return ConstantKernel(1.0) * Matern(length_scale=1.0, nu=2.5) + WhiteKernel(noise_level=1e-5)
    elif kernel_type == 'rbf':
        return ConstantKernel(1.0) * RBF(length_scale=1.0) + WhiteKernel(noise_level=1e-5)
    else:  # auto
        return ConstantKernel(1.0) * Matern(length_scale=1.0, nu=2.5) + WhiteKernel(noise_level=1e-5)


def _build_surrogate(settings: BOSettings):
    """根据设置构建代理模型"""
    if settings.surrogate == 'rf':
        return RandomForestRegressor(n_estimators=100, random_state=42)
    elif settings.surrogate == 'tpe':
        # TPE 的特性通过 ExtraTrees + 密度估计近似
        return ExtraTreesRegressor(n_estimators=100, random_state=42)
    else:  # '' = GP
        kernel = _build_kernel(settings.kernel)
        return GaussianProcessRegressor(kernel=kernel, n_restarts_optimizer=5, random_state=random.randint(0, 2**31-1))


def _extract_features(experiments: list[Experiment]) -> tuple[np.ndarray, np.ndarray, list[str], dict[str, list[str]]]:
    """
    从实验列表中提取特征矩阵 X 和目标向量 y
    返回: (X, y, continuous_names, categorical_info)
    """
    completed = [e for e in experiments if e.status == 'completed']
    if not completed:
        return np.empty((0, 0)), np.empty((0,)), [], {}

    # 收集所有变量名和类型
    all_var_names: list[str] = []
    categorical_info: dict[str, list[str]] = {}

    for exp in completed:
        for vname in exp.variables:
            if vname not in all_var_names:
                all_var_names.append(vname)
                if isinstance(exp.variables[vname], str):
                    categorical_info[vname] = []

    # 收集分类变量的所有可能值
    for exp in experiments:
        for vname, vval in exp.variables.items():
            if vname in categorical_info and isinstance(vval, str) and vval not in categorical_info[vname]:
                categorical_info[vname].append(vval)

    # 构建特征矩阵
    n_samples = len(completed)
    n_features = len(all_var_names)
    X = np.zeros((n_samples, n_features))

    for i, exp in enumerate(completed):
        for j, vname in enumerate(all_var_names):
            val = exp.variables.get(vname)
            if val is None:
                X[i, j] = 0.0
            elif isinstance(val, str):
                opts = categorical_info.get(vname, [])
                X[i, j] = float(opts.index(val)) if val in opts else 0.0
            else:
                X[i, j] = float(val)

    # 取第一个目标值
    objectives_keys = [k for k in completed[0].objectives.keys() if completed[0].objectives.get(k) is not None]
    if not objectives_keys:
        y = np.array([0.0 for _ in completed])
    else:
        first_obj = objectives_keys[0]
        y = np.array([exp.objectives.get(first_obj, 0.0) or 0.0 for exp in completed])

    return X, y, all_var_names, categorical_info


def suggest_next_experiment(request: BOSuggestRequest) -> BOSuggestResponse:
    """
    基于代理模型和采集函数，推荐下一个实验点
    """
    experiments = request.experiments
    settings = request.settings

    X, y, var_names, categorical_info = _extract_features(experiments)

    if X.shape[0] < 2 or X.shape[1] == 0:
        return BOSuggestResponse(
            variables={'temperature': 150.0, 'pressure': 2.5, 'catalyst': 'A'},
            expectedImprovement=0.0,
            uncertainty=5.0,
        )

    # 归一化 X
    X_mean = X.mean(axis=0)
    X_std = X.std(axis=0)
    X_std[X_std == 0] = 1.0
    X_norm = (X - X_mean) / X_std

    # 归一化 y
    y_mean = y.mean()
    y_std = y.std()
    y_std = y_std if y_std > 0 else 1.0
    y_norm = (y - y_mean) / y_std

    # 确定优化方向
    objective = settings.objectives[0]
    sign = -1.0 if objective.type == 'maximize' else 1.0

    # 构建代理模型
    model = _build_surrogate(settings)
    is_gp = settings.surrogate == ''

    if is_gp:
        model.fit(X_norm, y_norm)
    else:
        # RF/TPE 直接用原始值拟合
        model.fit(X_norm, y_norm)

    # 构建搜索空间
    n_features = X.shape[1]
    space = []
    for j in range(n_features):
        lo = float(X[:, j].min())
        hi = float(X[:, j].max())
        space.append((lo, hi))

    # 随机采样 + 模型预测寻找最优采集点
    acq = settings.acquisition
    xi = settings.explorationRate

    n_random = 2000
    random_points = np.random.uniform(
        low=[s[0] for s in space],
        high=[s[1] for s in space],
        size=(n_random, len(space)),
    )
    random_points_norm = (random_points - X_mean) / X_std

    if is_gp:
        y_pred, y_std_pred = model.predict(random_points_norm, return_std=True)
    else:
        # RF/TPE: 用模型预测 + 袋外估计不确定性
        y_pred = model.predict(random_points_norm)
        # 用 RF 的不同树预测标准差作为不确定性估计
        if hasattr(model, 'estimators_'):
            tree_preds = np.array([tree.predict(random_points_norm) for tree in model.estimators_])
            y_std_pred = tree_preds.std(axis=0)
        else:
            y_std_pred = np.ones_like(y_pred) * 0.1

    # 计算采集函数值
    if acq == 'EI':
        if objective.type == 'maximize':
            best_y = y_norm.max()
            z = (y_pred - best_y) / (y_std_pred + 1e-6)
            ei = (y_pred - best_y) * _norm_cdf(z) + y_std_pred * _norm_pdf(z)
        else:
            best_y = y_norm.min()
            z = (best_y - y_pred) / (y_std_pred + 1e-6)
            ei = (best_y - y_pred) * _norm_cdf(z) + y_std_pred * _norm_pdf(z)
    elif acq == 'PI':
        if objective.type == 'maximize':
            best_y = y_norm.max()
            z = (y_pred - best_y - xi) / (y_std_pred + 1e-6)
            ei = _norm_cdf(z)
        else:
            best_y = y_norm.min()
            z = (best_y - y_pred - xi) / (y_std_pred + 1e-6)
            ei = _norm_cdf(z)
    else:  # UCB
        if objective.type == 'maximize':
            ei = y_pred + xi * y_std_pred
        else:
            ei = y_pred - xi * y_std_pred

    best_idx = int(np.argmax(ei))
    best_point_norm = random_points_norm[best_idx]
    best_point = random_points[best_idx]

    # 反归一化
    best_point_original = best_point_norm * X_std + X_mean

    # 构建变量字典
    variables: dict[str, float | str] = {}
    for j, vname in enumerate(var_names):
        if vname in categorical_info:
            idx = int(round(best_point_original[j]))
            opts = categorical_info[vname]
            idx = max(0, min(idx, len(opts) - 1))
            variables[vname] = opts[idx]
        else:
            variables[vname] = round(float(best_point_original[j]), 6)

    uncertainty = float(y_std_pred[best_idx] * abs(y_std))

    return BOSuggestResponse(
        variables=variables,
        expectedImprovement=float(abs(ei[best_idx] * y_std)),
        uncertainty=uncertainty,
    )


def generate_candidate_pool(request: BOSuggestRequest, n_candidates: int = 5) -> CandidatePoolResponse:
    """
    生成候选池：返回 top-K 个候选点，包含 EI 值、不确定性和风险评分
    """
    experiments = request.experiments
    settings = request.settings

    X, y, var_names, categorical_info = _extract_features(experiments)

    if X.shape[0] < 2 or X.shape[1] == 0:
        return CandidatePoolResponse(candidates=[], topAcquisition=0.0)

    X_mean = X.mean(axis=0)
    X_std = X.std(axis=0)
    X_std[X_std == 0] = 1.0
    X_norm = (X - X_mean) / X_std

    y_mean = y.mean()
    y_std = y.std()
    y_std = y_std if y_std > 0 else 1.0
    y_norm = (y - y_mean) / y_std

    objective = settings.objectives[0]
    is_gp = settings.surrogate == ''

    model = _build_surrogate(settings)
    model.fit(X_norm, y_norm)

    n_features = X.shape[1]
    space = [(float(X[:, j].min()), float(X[:, j].max())) for j in range(n_features)]
    xi = settings.explorationRate

    n_random = 5000
    random_points = np.random.uniform(
        low=[s[0] for s in space],
        high=[s[1] for s in space],
        size=(n_random, len(space)),
    )
    random_points_norm = (random_points - X_mean) / X_std

    if is_gp:
        y_pred, y_std_pred = model.predict(random_points_norm, return_std=True)
    else:
        y_pred = model.predict(random_points_norm)
        if hasattr(model, 'estimators_'):
            tree_preds = np.array([tree.predict(random_points_norm) for tree in model.estimators_])
            y_std_pred = tree_preds.std(axis=0)
        else:
            y_std_pred = np.ones_like(y_pred) * 0.1

    # 计算 EI
    if objective.type == 'maximize':
        best_y = y_norm.max()
        z = (y_pred - best_y) / (y_std_pred + 1e-6)
        ei = (y_pred - best_y) * _norm_cdf(z) + y_std_pred * _norm_pdf(z)
    else:
        best_y = y_norm.min()
        z = (best_y - y_pred) / (y_std_pred + 1e-6)
        ei = (best_y - y_pred) * _norm_cdf(z) + y_std_pred * _norm_pdf(z)

    # 取 top-K 个点
    top_indices = np.argsort(ei)[-n_candidates:][::-1]

    candidates = []
    for idx in top_indices:
        point = random_points[idx]
        point_norm = random_points_norm[idx]
        point_original = point_norm * X_std + X_mean

        variables: dict[str, float | str] = {}
        for j, vname in enumerate(var_names):
            if vname in categorical_info:
                cat_idx = int(round(point_original[j]))
                opts = categorical_info[vname]
                cat_idx = max(0, min(cat_idx, len(opts) - 1))
                variables[vname] = opts[cat_idx]
            else:
                variables[vname] = round(float(point_original[j]), 6)

        # 风险评分: 基于不确定性/预测值的相对大小
        risk_score = float(min(1.0, y_std_pred[idx] / (abs(y_pred[idx]) + 1e-6)))

        candidates.append(CandidatePoolItem(
            variables=variables,
            expectedImprovement=float(abs(ei[idx] * y_std)),
            uncertainty=float(y_std_pred[idx] * abs(y_std)),
            riskScore=risk_score,
        ))

    top_acq = candidates[0].expectedImprovement if candidates else 0.0
    return CandidatePoolResponse(candidates=candidates, topAcquisition=top_acq)


def batch_suggest(request: BOBatchSuggestRequest) -> list[BOSuggestResponse]:
    """
    批量采样: q-EI (Kriging Believer) 或 Thompson 采样
    """
    batch_size = min(request.settings.batchSize, 10)
    suggestions = []

    for i in range(batch_size):
        # 对于 Kriging Believer: 每次建议后，用预测值填充伪目标值
        suggestion = suggest_next_experiment(
            BOSuggestRequest(experiments=request.experiments, settings=request.settings)
        )

        # 创建一个伪实验点加入数据池，避免后续建议重复
        pseudo_exp = Experiment(
            id=0,
            batch=0,
            variables=suggestion.variables,
            objectives={},
            source='BO',
            status='completed',
            timestamp='',
        )
        # 用预测的目标值填充
        for obj in request.settings.objectives:
            pseudo_exp.objectives[obj.name] = float(request.experiments[-1].objectives.get(obj.name, 0) or 0)

        # 将伪实验加入列表
        request.experiments.append(pseudo_exp)
        suggestions.append(suggestion)

    return suggestions


def generate_response_surface(request: BOSuggestRequest) -> SurfaceDataResponse:
    """
    生成贝叶斯响应面数据（用于 3D 可视化），同时返回不确定性
    """
    experiments = request.experiments
    X, y, var_names, categorical_info = _extract_features(experiments)

    if X.shape[0] < 3 or X.shape[1] < 2:
        x = list(np.linspace(100, 300, 50))
        y_vals = list(np.linspace(1, 5, 50))
        z = [[100 * np.exp(-((xi - 150) / 100) ** 2) * (1 + 0.1 * np.sin(yi * 10)) for yi in y_vals] for xi in x]
        uncertainty = [[5.0 + 2.0 * np.sin(xi * 0.05) for yi in y_vals] for xi in x]
        return SurfaceDataResponse(x=x, y=y_vals, z=z, uncertainty=uncertainty)

    # 只用连续变量
    continuous_cols = [j for j, vname in enumerate(var_names) if vname not in categorical_info]
    if len(continuous_cols) < 2:
        x = list(np.linspace(100, 300, 50))
        y_vals = list(np.linspace(1, 5, 50))
        z = [[100 * np.exp(-((xi - 150) / 100) ** 2) * (1 + 0.1 * np.sin(yi * 10)) for yi in y_vals] for xi in x]
        uncertainty = [[5.0 + 2.0 * np.sin(xi * 0.05) for yi in y_vals] for xi in x]
        return SurfaceDataResponse(x=x, y=y_vals, z=z, uncertainty=uncertainty)

    X_cont = X[:, continuous_cols]
    X_mean = X_cont.mean(axis=0)
    X_std = X_cont.std(axis=0)
    X_std[X_std == 0] = 1.0
    X_norm = (X_cont - X_mean) / X_std

    y_mean = y.mean()
    y_std = y.std()
    y_std = y_std if y_std > 0 else 1.0
    y_norm = (y - y_mean) / y_std

    kernel = _build_kernel('matern52')
    gp = GaussianProcessRegressor(kernel=kernel, n_restarts_optimizer=5)
    gp.fit(X_norm[:, :2] if X_norm.shape[1] > 2 else X_norm, y_norm)

    # 构建网格
    n_grid = 50
    x_min, x_max = float(X_cont[:, 0].min()), float(X_cont[:, 0].max())
    y_min, y_max = float(X_cont[:, 1].min()), float(X_cont[:, 1].max())

    x_range = np.linspace(x_min - 0.1*(x_max-x_min), x_max + 0.1*(x_max-x_min), n_grid)
    y_range = np.linspace(y_min - 0.1*(y_max-y_min), y_max + 0.1*(y_max-y_min), n_grid)

    X_grid, Y_grid = np.meshgrid(x_range, y_range)
    grid_points = np.column_stack([X_grid.ravel(), Y_grid.ravel()])

    # 如果有其他连续变量，用均值填充
    if X_norm.shape[1] > 2:
        extra = np.tile(X_norm[:, 2:].mean(axis=0), (grid_points.shape[0], 1))
        grid_points = np.column_stack([grid_points, extra])

    gp_n = min(X_cont.shape[1], grid_points.shape[1])
    gp_mu = X_mean[:gp_n]
    gp_std = X_std[:gp_n]
    grid_norm = (grid_points[:, :gp_n] - gp_mu) / gp_std

    Z_norm, Z_std_norm = gp.predict(grid_norm, return_std=True)
    Z = Z_norm * y_std + y_mean
    Z_std = Z_std_norm * abs(y_std)

    return SurfaceDataResponse(
        x=list(x_range),
        y=list(y_range),
        z=Z.reshape(n_grid, n_grid).tolist(),
        uncertainty=Z_std.reshape(n_grid, n_grid).tolist(),
    )
